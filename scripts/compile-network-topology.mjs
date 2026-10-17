export function compileNetworkTopology(topology, deviceNames) {
  if (!topology || !Array.isArray(topology.nodes) || !Array.isArray(topology.links)) {
    throw new Error('Network topology must contain node and link arrays.')
  }

  const nodeIds = new Set(topology.nodes.map((node) => node?.id).filter((id) => typeof id === 'string'))
  if (!topology.rootNodeId || !nodeIds.has(topology.rootNodeId) || nodeIds.size !== topology.nodes.length ||
    topology.links.some((link) => !nodeIds.has(link?.source) || !nodeIds.has(link?.target))) {
    throw new Error('Network topology has a missing root, duplicate node ID, or dangling link.')
  }

  const nodes = topology.nodes.map((node) => {
    if (!node.ip) return node
    const expectedId = `host-${String(node.ip).replaceAll('.', '-')}`
    if (node.id !== expectedId) {
      throw new Error(`Topology node ${node.id} does not use the canonical ID ${expectedId} for ${node.ip}.`)
    }
    if (!Object.hasOwn(deviceNames, node.ip)) {
      throw new Error(`Topology node ${node.id} is missing from the canonical device-name matrix.`)
    }
    return { ...node, label: deviceNames[node.ip] }
  })

  const wifiTargets = new Set(topology.links
    .filter((link) => link.source === topology.rootNodeId && link.kind === 'physical' && link.type === 'wireless')
    .map((link) => link.target))
  for (const node of nodes) {
    if (node.layer === 'wifi' && !wifiTargets.has(node.id)) {
      throw new Error(`Wi-Fi topology node ${node.id} must connect wirelessly to the gateway.`)
    }
  }

  return { ...topology, nodes }
}
