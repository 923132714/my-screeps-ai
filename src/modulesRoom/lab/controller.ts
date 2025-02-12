import { Color, colorful } from '@/modulesGlobal'
import { getUniqueKey } from '@/utils'
import { TransportTaskType } from '../taskTransport/types'
import RoomAccessor from '../RoomAccessor'
import { LAB_TARGETS, REACTION_SOURCE } from './constant'
import { BoostState, LabMemory, LabState, BoostTask, BoostResourceConfig, LabType } from './types'

/**
 * lab 集群拓展
 */
export default class LabController extends RoomAccessor<LabMemory> {
    constructor(roomName: string) {
        super('lab', roomName, 'lab', {
            boostTasks: {},
            boostingNote: {}
        })

        this.initLabInfo()
    }

    private labInfos: {
        [id: string]: { type: LabType }
    } = {}

    /**
     * 底物存放 lab
     */
    get inLabs(): StructureLab[] {
        if (!this.memory.inLab) return []
        return this.memory.inLab.map(id => Game.getObjectById(id))
    }

    /**
     * 正在执行强化任务的 lab
     */
    get boostLabs(): StructureLab[] {
        return Object.entries(this.labInfos)
            .filter(([id, { type }]) => type === LabType.Boost)
            .map(([id]) => Game.getObjectById(id))
    }

    /**
     * 正在参与反应的 lab
     * 注意！这些 lab 中不包含 inLab
     */
    get reactionLabs(): StructureLab[] {
        return Object.entries(this.labInfos)
            .filter(([id, { type }]) => type === LabType.Reaction)
            .map(([id]) => Game.getObjectById(id))
    }

    // 根据当前房间情况重新设置 lab 状态信息
    private initLabInfo() {
        // 所有 lab 都默认为反应 lab
        this.labInfos = this.room[STRUCTURE_LAB].map(lab => lab.id).reduce((result, id) => {
            result[id] = { type: LabType.Reaction }
            return result
        }, {})

        // 设置 boost lab
        Object.values(this.memory.boostTasks).map(({ res }) => {
            res.map(({ lab }) => this.labInfos[lab] = { type: LabType.Boost })
        });

        // 设置 inLab，如果 inLab 参加强化了就先保持原样
        (this.memory.inLab || []).forEach(id => {
            if (this.labInfos[id].type != LabType.Boost) this.labInfos[id].type = LabType.Base
        })
    }

    /**
     * 切换 lab 的状态
     * @param id 要更新类型的 lab id
     * @param toType 更新到的类型
     */
    private changeLabType(id: Id<StructureLab>, toType: LabType.Boost | LabType.Reaction) {
        const info = this.labInfos[id]
        if (!info) return
        info.type = toType
    }

    public runReactionController(): void {
        // lab 集群被暂停，停止执行合成
        if (this.memory.pause) return
        if (!this.room._hasRunLab) {
            this.reactionController()
            this.room._hasRunLab = true
        }
    }

    /**
     * 反应流程控制器
     */
    private reactionController(): void {
        switch (this.memory.reactionState) {
            case LabState.GetTarget:
                if (Game.time % 10 || this.inLabs.length < 2) return
                this.labGetTarget()
            break
            case LabState.GetResource:
                if (Game.time % 15) return
                this.labGetResource()
            break
            case LabState.Working:
                if (Game.time % 2) return
                this.labWorking()
            break
            case LabState.PutResource:
                if (Game.time % 15) return
                this.labPutResource()
            break
            default:
                if (Game.time % 10 || this.inLabs.length < 2) return
                this.labGetTarget()
        }
    }

    public runBoostController(): void {
        if (Object.keys(this.memory.boostTasks).length > 0 && !(Game.time % 10)) {
            Object.values(this.memory.boostTasks).map(task => this.boostController(task))
        }
    }

    /**
     * 强化流程控制器
     */
    private boostController(task: BoostTask): void {
        switch (task.state) {
            case BoostState.GetLab:
                this.boostGetLab(task)
            case BoostState.GetResource:
                this.boostGetResource(task)
            break
            case BoostState.GetEnergy:
                this.boostGetEnergy(task)
            break
            case BoostState.WaitBoost:
                // 感受宁静
            break
            case BoostState.ClearResource:
                this.boostClear(task)
            break
            default:
                this.boostGetLab(task)
        }
    }

    /**
     * 新增强化任务
     * 
     * @param resConfig 该任务的强化材料配置
     * @return 该任务的唯一 id
     */
    public addBoostTask(resConfig: BoostResourceConfig[]): number {
        const taskData: BoostTask = {
            id: getUniqueKey(),
            res: _.cloneDeep(resConfig),
            state: BoostState.GetLab
        }

        this.memory.boostTasks[taskData.id] = taskData

        // 执行一次 lab 分配，如果分配失败的话后面还会定期执行分配
        this.boostGetLab(taskData)
        return taskData.id
    }

    /**
     * 移除强化任务
     * @param taskId 要移除的任务索引
     */
    public removeBoostTask(taskId: number) {
        delete this.memory.boostTasks[taskId]
    }

    /**
     * boost 阶段：获取强化 lab
     * 进入这个阶段是因为有 lab 正在执行反应，需要等待其净空
     */
    private boostGetLab(task: BoostTask): void {
        // 检查是否已经有正在执行的移出任务
        if (this.room.transport.hasTask(TransportTaskType.LabOut)) return

        // 需要清空的 lab 数组
        const needClearLabs: StructureLab[] = []

        // 将 lab 分配到 boost 任务上
        const assignLab = (labs: StructureLab[]) => {
            for (const boostRes of task.res) {
                const lab = labs.shift()
                boostRes.lab = lab.id
                this.changeLabType(lab.id, LabType.Boost)
                needClearLabs.push(lab)
            }
        }

        const reactionLabs = this.reactionLabs
        const inLabs = this.inLabs

        // 反应 lab 数量足够，直接使用
        if (reactionLabs.length >= task.res.length) {
            assignLab(reactionLabs)
        }
        // 反应 lab 数量不足了，加上 in lab 试试
        else if (reactionLabs.length + inLabs.length >= task.res.length) {
            const labList = [...reactionLabs, ...inLabs]
            assignLab(labList)
            // 数量足够的话就直接把整个反应程序停了，inLab 都去 boost 了还合成个啥
            needClearLabs.push(...labList)
            this.memory.reactionState = LabState.PutResource
            delete this.memory.reactionAmount
        }

        this.room.transport.addTask({
            type: TransportTaskType.LabOut,
            labId: needClearLabs.map(({ id }) => id)
        })

        const allSet = task.res.every(({ lab }) => !!lab)
        // lab 分配好了，进行下一步操作
        if (!allSet) return
        task.state = BoostState.GetResource
    }

    /**
     * boost 阶段：获取强化材料
     */
    private boostGetResource(task: BoostTask): void {    
        if (this.room.transport.hasTask(TransportTaskType.LabIn)) return
    
        // 遍历检查资源是否到位
        const allResourceReady = task.res.every(res => {
            const lab = Game.getObjectById(res.lab)
            // 有 lab 被摧毁了，任务失败
            if (!lab) {
                task.state = BoostState.ClearResource
                return false
            }

            return lab.store[res.resource] >= res.amount
        })

        // 都就位了就进入下一个阶段
        if (allResourceReady) {
            this.log(`boost 材料准备完成，开始填充能量`, Color.Green)
            task.state = BoostState.GetEnergy
        }
        // 否则就发布资源移入任务
        else if (!this.room.transport.hasTask(TransportTaskType.LabIn)) {
            this.room.transport.addTask({
                type: TransportTaskType.LabIn,
                resource: task.res.map(res => ({
                    id: res.lab,
                    type: res.resource,
                    amount: res.amount
                }))
            })
        }
    }

    /**
     * boost 阶段：获取能量
     */
    private boostGetEnergy(task: BoostTask): void {
        // 遍历所有执行强化的 lab
        for (const res of task.res) {
            const lab = Game.getObjectById(res.lab)

            // 有 lab 能量不达标的话就发布能量填充任务
            if (lab && lab.store[RESOURCE_ENERGY] < 1000 && !this.room.transport.hasTask(TransportTaskType.LabGetEnergy)) {
                this.room.transport.addTask({ type: TransportTaskType.LabGetEnergy })
                return
            }
        }

        // 能循环完说明能量都填好了
        task.state = BoostState.WaitBoost
    }

    /**
     * 强化指定 creep
     * @param creep 要强化的 creep
     * @param boostTaskId 要执行的强化任务
     * @returns 强化是否完成（因出现问题导致无法正常完成强化也会返回 true）
     */
    public boostCreep(creep: Creep, taskId: number): boolean {
        const task = this.memory.boostTasks[taskId]
        if (!task) return true

        // 之前没来强化过，新建个档案
        if (!(creep.name in this.memory.boostingNote)) {
            this.memory.boostingNote[creep.name] = task.res.map(res => ({
                labId: res.lab,
                boosted: false
            }))
        }

        const boostingNote = this.memory.boostingNote[creep.name]
        // 掏出来所有清单上还没强化过的 lab，挨个执行强化
        boostingNote.filter(({ boosted }) => !boosted).map((notBoostLab, index) => {
            const lab = Game.getObjectById(notBoostLab.labId)
            if (!lab) {
                notBoostLab.boosted = true
                return
            }

            const boostResult = lab.boostCreep(creep)
            if (boostResult === OK || boostResult === ERR_NOT_FOUND) notBoostLab.boosted = true
            // 一直朝第一个没执行强化的 lab 走
            if (index === 0) creep.goTo(lab.pos)
        })

        const allBoost = boostingNote.every(({ boosted }) => boosted)
        // 如果都强化了就说明 boost 成功了，清除临时存储
        if (allBoost) delete this.memory.boostingNote[creep.name]
        return allBoost
    }

    public getBoostState(taskId: number): ERR_NOT_FOUND | BoostState {
        const task = this.memory.boostTasks[taskId]
        if (!task) return ERR_NOT_FOUND
        return task.state
    }

    public finishBoost(taskId: number): void {
        const task = this.memory.boostTasks[taskId]
        if (!task) return
        task.state = BoostState.ClearResource
    }

    /**
     * boost 阶段：回收材料
     * 将强化用剩下的材料从 lab 中转移到 terminal 中
     */
    private boostClear(task: BoostTask): void {
        if (this.room.transport.hasTask(TransportTaskType.LabOut)) return

        const allClear = task.res.every(res => {
            const lab = Game.getObjectById(res.lab)
            // lab 没了或者资源清空了
            return !lab || !!lab.mineralType
        })

        // 没有全部净空，添加回收任务
        if (!allClear) {
            this.room.transport.addTask({
                type: TransportTaskType.LabOut,
                labId: task.res.map(res => res.lab)
            })
            return
        }

        this.removeBoostTask(task.id)
        this.initLabInfo()
        this.log(`强化材料回收完成`, Color.Green)
    }

    /**
     * lab 阶段：获取反应目标
     */
    private labGetTarget(): void {
        const resource = LAB_TARGETS[this.memory.reactionIndex || 0]

        // 如果 targetIndex 没有找到对应资源的话，就更新索引再试一次
        // 一般都是因为修改了 LAB_TARGETS 导致的
        if (!resource) {
            this.setNextIndex()
            return
        }

        // 目标资源数量已经足够了就不合成
        if (this.room.myStorage.getResource(resource.target).total >= resource.number) {
            this.setNextIndex()
            return
        }

        // 确认是否可以合成
        const canReactionAmount = this.getReactionAmount(resource.target)
        // 可以合成
        if (canReactionAmount > 0) {
            this.memory.reactionState = LabState.GetResource

            // 最小的就是目标合成数量
            this.memory.reactionAmount = Math.min(
                // 单次 lab 能合成的最大值
                LAB_MINERAL_CAPACITY,
                // 家里素材能合成的最大值
                canReactionAmount,
                // 当前距离期望值差了多少
                resource.number - this.room.myStorage.getResource(resource.target).total
            )

            this.log(`指定合成目标：${resource.target}`)
        }
        // 合成不了
        else {
            // this.log(`无法合成 ${resource.target}`, Color.Yellow)
            this.setNextIndex()
        }
    }

    /**
     * lab 阶段：获取底物
     */
    private labGetResource(): void {
        // 检查是否有资源移入任务
        if (this.room.transport.hasTask(TransportTaskType.LabIn)) return

        // 检查 InLab 底物数量，都有底物的话就进入下个阶段
        if (this.inLabs.every(lab => lab.store[lab.mineralType] >= this.memory.reactionAmount)) {
            this.memory.reactionState = LabState.Working
            return
        }

        // 检查存储里的底物数量是否足够
        const targetResource = LAB_TARGETS[this.memory.reactionIndex].target
        const hasInsufficientResource = REACTION_SOURCE[targetResource].find(res => {
            return this.room.myStorage.getResource(res).total < this.memory.reactionAmount
        })

        // 有不足的底物, 重新查找目标
        if (hasInsufficientResource) {
            this.memory.reactionState = LabState.GetTarget
            this.setNextIndex()
        }
        // 没有就正常发布底物填充任务
        else this.getReactionResource()
    }

    /**
     * lab 阶段：进行反应
     */
    private labWorking(): void {
        const { cooldownTime } = this.memory
        const inLabs = this.inLabs

        // 还没冷却好
        if (cooldownTime && Game.time < cooldownTime) return

        // inLab 不够了，可能是被借去 boost 了，进入下个阶段
        if (inLabs.length < 2) {
            this.memory.reactionState = LabState.PutResource
            return
        }

        // 遍历 lab 执行反应
        for (const lab of this.reactionLabs) {
            const runResult = lab.runReaction(inLabs[0], inLabs[1])

            // 反应成功后等待反应炉冷却
            // 这里需要注意的是，runReaction之后 cooldown 不会立刻出现，而是等到下个 tick 执行反应之后才会出现
            // 所以下面这个 cooldownTime 的计数是在下个 tick 时运行的
            if (runResult === ERR_TIRED) {
                this.memory.cooldownTime = Game.time + lab.cooldown + 1
                return
            }
            // 底物不足的话就进入下个阶段
            else if (runResult === ERR_NOT_ENOUGH_RESOURCES) {
                this.memory.reactionState = LabState.PutResource
                return
            }
            else if (runResult !== OK) {
                this.log(`runReaction 异常，错误码 ${runResult}`, Color.Red)
            }
        }
    }

    /**
     * lab 阶段：移出产物
     */
    private labPutResource(): void {
        // 检查是否已经有正在执行的移出任务
        if (this.room.transport.hasTask(TransportTaskType.LabOut)) return

        const workLabs = [...this.reactionLabs, ...this.inLabs]
        const needCleanLabs = workLabs.filter(lab => lab.mineralType)
        // 还有没净空的就发布移出任务
        if (needCleanLabs.length > 0) {
            this.room.transport.addTask({
                type: TransportTaskType.LabOut,
                labId: needCleanLabs.map(lab => lab.id)
            })
            return
        }

        // 都移出去的话就可以开始新的轮回了
        this.memory.reactionState = LabState.GetTarget
        delete this.memory.reactionAmount
        this.setNextIndex()
    }

    /**
     * 将 lab.targetIndex 设置到下一个目标
     * 
     * @returns 当前的目标索引
     */
    private setNextIndex(): number {
        this.memory.reactionIndex = ((this.memory.reactionIndex || 0) + 1) % LAB_TARGETS.length
        return this.memory.reactionIndex
    }

    /**
     * 查询目标资源可以合成的数量
     * 
     * @param resourceType 要查询的资源类型
     * @returns 可以合成的数量，为 0 代表无法合成
     */
    private getReactionAmount(resourceType: ResourceConstant): number {
        // 获取资源及其数量
        const needResourcesName = REACTION_SOURCE[resourceType]
        if (!needResourcesName) {
            this.log(`reactionSource 中未定义 ${resourceType}`, Color.Yellow)
            return 0
        }
        // 将底物按数量从小到大排序
        const needResources = needResourcesName
            .map(res => this.room.myStorage.getResource(res).total)
            .sort((a, b) => a - b)

        // 根据短板底物计算可合成数量
        // 这里取余了下 LAB_REACTION_AMOUNT 是因为一次反应最少需要这么多底物，多拿了也合不了
        return needResources[0] - (needResources[0] % LAB_REACTION_AMOUNT)
    }

    /**
     * 获取当前合成需要的底物
     */
    private getReactionResource(): void {
        // 获取目标产物
        const targetResource = LAB_TARGETS[this.memory.reactionIndex].target
        // 获取底物及其数量
        const resource = REACTION_SOURCE[targetResource].map((resourceType, index) => ({
            id: this.inLabs[index].id,
            type: resourceType,
            amount: this.memory.reactionAmount
        }))

        // 发布任务
        this.room.transport.addTask({ type: TransportTaskType.LabIn, resource })
    }

    /**
     * 设置底物存放 lab
     * @param labA 第一个底物存放 lab
     * @param labB 第二个底物存放 lab
     */
    public setBaseLab(labA: StructureLab, labB: StructureLab): void {
        this.memory.inLab = [labA.id, labB.id]
    }

    /**
     * 暂停 lab 反应
     */
    public off(): void {
        this.memory.pause = true
    }

    /**
     * 重启 lab 反应
     */
    public on(): void {
        delete this.memory.pause
    }

    public stats(): string {
        const { reactionState, reactionIndex, pause, reactionAmount, boostTasks } = this.memory
        const logs = [ `[化合物合成]` ]

        const reactionLogs = []
        if (this.inLabs.length < 2) reactionLogs.push(colorful('未设置底物 lab，暂未启用', Color.Yellow))
        if (pause) reactionLogs.push(colorful('暂停中', Color.Yellow))
        reactionLogs.push(`- [状态] ${reactionState}`)
        logs.push(reactionLogs.join(' '))

        // 在工作就显示工作状态
        if (reactionState === LabState.Working) {
            // 获取当前目标产物以及 terminal 中的数量
            const res = LAB_TARGETS[reactionIndex]
            const currentAmount = this.room.myStorage.getResource(res.target)
            logs.push(
                `- [工作进展] 目标 ${res.target} 本次生产/当前存量/目标存量 ` +
                `${reactionAmount}/${currentAmount.total}/${res.number}`
            )
        }
        else if (reactionState === LabState.GetTarget) {
            const targetLogs = LAB_TARGETS.map(({ target, number }, index) => {
                let log = `- [待选目标] ${colorful(target, Color.Blue)} [目标数量] ${colorful(number.toString(), Color.Blue)}`
                if (reactionIndex === index) log += ' <= 正在检查'
                return log
            })
            logs.push(targetLogs.join('\n'))
        }

        logs.push('[强化任务]')

        if (Object.keys(boostTasks).length == 0) logs.push('- 暂无任务')
        else {
            const taskLogs = Object.values(boostTasks).map(task => {
                const info = `- [${task.id}] [当前阶段] ${task.state} `
                const resLog = task.res.map(res => `[${res.resource}] ${res.amount}`).join(' ')
                return info + resLog
            })

            logs.push(...taskLogs)
        }

        return logs.join('\n')
    }
}
