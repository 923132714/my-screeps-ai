import { calcBodyPart } from '../bodyUtils'
import { CreepConfig, CreepRole } from '../types/role'
import { boostPrepare } from './configPart'

/**
 * 强化 - HEAL
 * 7 级以上可用, 25HEAL 25MOVE
 * 详情见 role.doctor
 * 
 * @param creepsName 要治疗的 creep 名称
 */
const boostDoctor: CreepConfig<CreepRole.BoostDoctor> = {
    isNeed: (room, preMemory) => preMemory.data.keepSpawn,
    prepare: creep => {
        // 治疗单位不允许发起对穿
        if (!creep.memory.disableCross) creep.memory.disableCross = true

        return boostPrepare().prepare(creep)
    },
    target: creep => {
        const target = Game.creeps[creep.memory.data.creepName]
        if (!target) {
            creep.say('💤')
            return false
        }
        creep.healTo(target)
        return false
    },
    bodys: () => calcBodyPart({ [TOUGH]: 12, [HEAL]: 25, [MOVE]: 10 })
}

export default boostDoctor