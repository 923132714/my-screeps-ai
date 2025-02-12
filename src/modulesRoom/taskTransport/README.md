# 房间物流任务模块

房间物流是指处理房间以内、中央集群以外的能量及资源转移任务，由 manager 角色负责。

# 房间物流任务

- spawn 及 extension 能量填充
- tower 能量填充
- lab 资源存取
- nuker 资源填充

# 与中央物流的区别

由于中央物流所参与的建筑较少（storage、terminal、factory 以及中央 link），所以在中央物流队列里发布的任务都是标准的资源转移任务：拥有确定的资源提供建筑、资源接收建筑、资源类型以及转移量。`processor` 在处理时只靠任务里提供的信息就可以完成转交。而房间物流不同，房间内的物流任务可变性太高。通过标准的资源转移任务很难实现（例如每个 extension 都发布一个到自己的资源转移任务的话会导致队列里突然塞入大量的任务从而出现 cpu 飙升），所以 `manager` 针对每个任务都会由不同的处理方式，并且在处理时会根据任务提供的信息再结合自己的 `Room.find` 之类来完成任务。 

# 任务详解

## spawn 及 extension 能量填充

- **任务发布：** 在 spawn 发现房间能量（`energyAvailable`）不足时会向房间物流队列推送 `fillExtension` 任务。
- **任务内容：** 该任务只有一个类型，没有其他内容，如下：

```js
{
    type: 'fillExtension'
}
```

- **任务处理：** `manager` 角色在发现此任务时会先调用 `Room.find` 查找缺失能量的 extension 和 spawn。然后寻找最近的进行能量填充。
- **任务关闭：** `manager` 调用 `Room.find` 一旦返回空数组（找不到缺失能量的 extension 或者 spawn 了）。就说明该任务已经完成。

## tower 能量填充

- **任务发布：** 在 tower 发现自己的能量低于 600（日常）或者能量低于 900（有入侵者）时，就会向房间物流队列推送 `fillTower` 任务。
- **任务内容：** 该任务有两个字段，名称和推送 tower id，如下：

```js
{
    type: 'fillTower',
    id: '5d9bdd4b1acf0f000174aa4b'
}
```

- **任务处理：** `manager` 角色在发现此任务时会先填充任务中提供 id 的 tower。在该 tower 填满后会在调用 `Room.find` 搜索其他能量小于 900 的 tower 进行填充。
- **任务关闭：** `manager` 调用 `Room.find` 一旦返回空数组（找不到能量低于 900 的 tower）。就说明该任务已经完成了。
- **备注：** 为啥要找能量低于 900 而不是能量不满的 tower 呢，因为现在 tower 负责刷墙，很容易就出现能量不满的情况，为了避免在这个任务上浪费太多时间，所以把条件放低点。

## lab 资源存取

lab 包含两个物流任务，labIn（底物填充）、labOut（产物移出）。

**labIn** 任务:

- **任务发布：** lab 集群在 `getResource` 阶段发布
- **任务内容：** 该任务有两个字段，类型、要转移的资源数组，如下：

```js
{
    type: 'labIn',
    resource: [
        {
            // 要转移到的 lab id
            id: '5d9bdd4b1acf0f000174aa4b',
            // 要转移的资源类型
            type: RESOURCE_HYDROGEN,
            // 要转移的数量
            amount: 1000
        },
        {
            id: '5d9bdd4b1acf0f000174aa4b',
            type: RESOURCE_OXIDANT,
            amount: 1000
        }
    ]
}
```

- **任务处理：** 根据任务内容拿取资源，填充资源时会根据填充量来减少对应的 amount。
- **任务关闭：** 任务内容中所有 resource 的 amount 都为 0 时任务完成。

**labOut** 任务：

- **任务发布：** lab 集群在 `putResource` 阶段发布
- **任务内容：** 该任务只有一个类型，如下：

```js
{
    type: 'labOut'
}
```

- **任务处理：** 将所有 lab（包括 inLab）中的资源全部转移至 terminal 中。
- **任务关闭：** 所有 lab 的 `mineralType` 都为空。

## nuker 资源填充

- **任务发布：** 在 nuker 发现自己的能量没满时，并且自己所需要的资源数量足够时（storage 中能量大于 300k 或者 terminal 中 G 矿大于 1k）就会向房间物流队列推送 `fillNuker` 任务。
- **任务内容：** 该任务有三个字段，名称、推送 nuker id 和要填充的资源类型，如下：

```js
{
    type: 'fillTower',
    id: '5d9bdd4b1acf0f000174aa4b',
    resourceType: RESOURCE_ENERGY
}
```

- **任务处理：** `manager` 角色在发现此任务时会先通过 id 检查 nuker 的 store，如果要填充的资源数量大于自己的容量，就去装满，小于的话就该装多少装多少。
- **任务关闭：** `manager` 将资源放入到 nuker 中即代表任务已经完成。

## Boost 任务

Boost 包含三个物流任务，分别是 boostGetResource（获取强化材料）、boostGetEnergy（获取强化能量）、boostClear（移出强化材料）。

**boostGetResource** 任务：

- **任务发布：** boost 进程 `boostGet` 阶段发布
- **任务内容：** 该任务有两个字段，类型、要转移的资源数组，如下：

```js
{
    type: 'boostGetResource',
    resource: [
        {
            type: RESOURCE_CATALYZED_GHODIUM_ACID,
            labId: '5d9bdd4b1acf0f000174aa4a',
            number: 150
        },
        {
            type: RESOURCE_CATALYZED_KEANIUM_ACID,
            labId: '5d9bdd4b1acf0f000174aa4b',
            number: 50
        },
        // ...
    ]
}
```

- **任务处理：** 遍历 `task.resource` 持续搬运直到 number 都为 0。
- **任务关闭：** 所有 `task.resource[ResourceType].number` 的值都为 0。

**boostGetEnergy** 任务：

- **任务发布：** lab 集群在 `boostGetEnergy` 阶段发布
- **任务内容：** 该任务只有一个字段，任务类型，如下：

```js
{
    type: 'labGetEnergy'
}
```

- **任务处理：** 把所有 `Room.memory.boost.lab` 里的能量都填满。

**boostClear** 任务：

- **任务发布：** boost 进程 `boostClear` 阶段发布
- **任务内容：** 该任务有一个字段：类型，如下：

```js
{
    type: 'boostGetResource'
}
```

- **任务处理：** 遍历 `Room.memory.boost.lab` 把其中的 lab 都搬空。