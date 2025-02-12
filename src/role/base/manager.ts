import { bodyConfigs, specialBodyConfig, createBodyGetter } from '../bodyUtils'
import { CreepConfig, CreepRole } from '../types/role'

/**
 * manager 触发后事处理的最小生命
 */
const TRANSFER_DEATH_LIMIT = 20

/**
 * 搬运工，运营单位
 * 负责填充 extension、spawn、tower、lab 等资源运输任务
 */
const manager: CreepConfig<CreepRole.Manager> = {
    isNeed: (room, preMemory, creepName) => {
        // 如果自己被炒鱿鱼了就不再孵化
        if (room.transport.haveCreepBeenFired(creepName)) {
            room.transport.removeCreep(creepName)
            return false
        }
        // 普通体型的话就一直孵化，特殊体型的话如果还有要做的任务就继续孵化
        return !preMemory.bodyType || !!preMemory.taskKey
    },
    prepare: creep => {
        creep.memory.bodyType = creep.memory.data.bodyType
        return true
    },
    source: creep => {
        const { sourceId, workRoom } = creep.memory.data
        if (creep.ticksToLive <= TRANSFER_DEATH_LIMIT) return deathPrepare(creep, sourceId)

        return Game.rooms[workRoom]?.transport.getWork(creep).source()
    },
    target: creep => {
        const { workRoom } = creep.memory.data
        return Game.rooms[workRoom]?.transport.getWork(creep).target()
    },
    bodys: (room, spawn, data) => {
        // 指定了特殊身体部件的话就生成对应的
        if (data.bodyType) return specialBodyConfig[data.bodyType](room, spawn)
        // 否则就使用默认的身体部件
        return createBodyGetter(bodyConfigs.manager)(room, spawn)
    }
}

/**
 * 快死时的后事处理
 * 将资源存放在对应的地方
 * 存完了就自杀
 * 
 * @param creep manager
 * @param sourceId 能量存放处
 */
const deathPrepare = function(creep: Creep, sourceId: Id<StructureWithStore>): false {
    if (creep.store.getUsedCapacity() > 0) {
        for (const resourceType in creep.store) {
            let target: StructureWithStore
            // 不是能量就放到 terminal 里
            if (resourceType != RESOURCE_ENERGY && resourceType != RESOURCE_POWER && creep.room.terminal) {
                target = creep.room.terminal
            }
            // 否则就放到 storage 或者玩家指定的地方
            else target = sourceId ? Game.getObjectById(sourceId): creep.room.storage
            // 刚开新房的时候可能会没有存放的目标
            if (!target) return false

            // 转移资源
            creep.goTo(target.pos)
            creep.transfer(target, <ResourceConstant>resourceType)
            
            return false
        }
    }
    else creep.suicide()

    return false
}

export default manager