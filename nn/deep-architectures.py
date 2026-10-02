"""Parent-preserving residual extensions and a plain tanh depth ablation."""
import copy
STYLES = ('plain', 'residual', 'bridges', 'wispy')


def make(torch, nn, grow, parent, width, depth, style):
    if style not in STYLES or depth < 2:
        raise ValueError('invalid deep style/depth')
    old_depth = len(parent['sizes']) - 2
    if depth <= old_depth:
        raise ValueError('deep experiment must add hidden layers to the parent')
    if style == 'plain':
        sizes = [parent['sizes'][0]] + [width] * depth + [1]
        layers = [nn.Linear(sizes[i], sizes[i+1]) for i in range(len(sizes)-1)]
        # Positive diagonal weights help gradients cross the extra tanh layers. This is NOT identity.
        with torch.no_grad():
            for li in range(1, depth):
                layers[li].weight.zero_()
                layers[li].weight.diagonal().fill_(1.0)
                layers[li].bias.zero_()
        return layers, sizes, None
    # First widen (if needed) without changing the parent's predictions.
    inherited, old_sizes = grow.grow_linears(torch, nn, parent, width)
    sizes = [parent['sizes'][0]] + [width] * depth + [1]
    old_topo = parent.get('topology')
    routes = [copy.deepcopy(grow.value_topology.routes_for(old_topo, li)) for li in range(old_depth)]
    old_residuals = [li for li in range(1, old_depth) if old_topo
                     and float(old_topo['residualScale']) != 0
                     and parent['sizes'][li] == parent['sizes'][li+1]
                     and ('residualLayers' not in old_topo or li in old_topo['residualLayers'])]
    for li in range(old_depth, depth):
        edges = []
        if style == 'bridges' and (li - old_depth) % 5 == 0:
            edges = [[li - 5, min(10, width)]] if li >= 5 else []
        elif style == 'wispy':
            edges = [[li-gap, min(2, width)] for gap in (2, 5, 9) if li >= gap]
        routes.append(edges)
    # Preserve the old head's packets, rather than silently adding new dependencies.
    routes.append(copy.deepcopy(grow.value_topology.routes_for(old_topo, old_depth)))
    topo = {'kind': 'dense-memory-v1', 'memoryWidth': int((old_topo or {}).get('memoryWidth', 1)),
            'residualScale': float((old_topo or {}).get('residualScale', 0.2)) or 0.2,
            'memoryRoutes': routes, 'residualLayers': old_residuals + list(range(old_depth, depth))}
    fan_ins = grow.fan_ins_for(sizes, topo)
    layers = inherited[:-1]
    with torch.no_grad():
        for li in range(old_depth, depth):
            layer = nn.Linear(fan_ins[li], width)
            layer.weight.zero_(); layer.bias.zero_()  # a + scale*tanh(0) = a exactly
            layers.append(layer)
    layers.append(inherited[-1])
    if layers[-1].in_features != fan_ins[-1]:
        raise ValueError('head packet mapping changed unexpectedly')
    return layers, sizes, topo
