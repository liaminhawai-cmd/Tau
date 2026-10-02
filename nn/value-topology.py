"""Shared PyTorch inference for legacy dense memory and explicitly routed packets.

memoryRoutes[li] lists [source_hidden_layer, packet_width] in concatenation order.
The full predecessor is always first; packets must come from earlier predecessors.
residualLayers, when supplied, selects exactly which hidden layers add their input.
Omitting both fields preserves dense-memory-v1's original semantics.
"""
def routes_for(topology, li):
    if not topology or li == 0:
        return []
    if 'memoryRoutes' in topology:
        return topology['memoryRoutes'][li]
    return [[src, int(topology['memoryWidth'])] for src in range(li - 1)]


def fan_ins_for(sizes, topology):
    if not topology:
        return sizes[:-1]
    if topology.get('kind') != 'dense-memory-v1':
        raise ValueError('unsupported value topology')
    if 'memoryRoutes' in topology and len(topology['memoryRoutes']) != len(sizes) - 1:
        raise ValueError('memoryRoutes must have one entry per affine layer')
    if 'residualLayers' in topology:
        if len(set(topology['residualLayers'])) != len(topology['residualLayers']):
            raise ValueError('duplicate residual layer')
        for li in topology['residualLayers']:
            if not isinstance(li, int) or not 0 < li < len(sizes) - 2 or sizes[li] != sizes[li + 1]:
                raise ValueError('residual layers must be equal-width hidden transitions')
    result = []
    for li in range(len(sizes) - 1):
        routes = routes_for(topology, li)
        seen = set()
        for src, width in routes:
            if (not isinstance(src, int) or not isinstance(width, int) or src in seen
                    or not 0 <= src < li - 1 or not 1 <= width <= sizes[src + 1]):
                raise ValueError('invalid or duplicate memory packet route')
            seen.add(src)
        result.append(sizes[li] + sum(width for _, width in routes))
    return result


def build_model(torch, nn, linears, topology, device):
    if not topology:
        return nn.Sequential(*[part for layer in linears for part in (layer, nn.Tanh())]).to(device)
    class RoutedValueNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.layers = nn.ModuleList(linears)
        def forward(self, x):
            a, memories = x, []
            for li, layer in enumerate(self.layers):
                packets = [memories[src][:, :width] for src, width in routes_for(topology, li)]
                branch = torch.tanh(layer(torch.cat([a] + packets, dim=1) if packets else a))
                residual = (float(topology['residualScale']) != 0 and 0 < li < len(self.layers) - 1
                            and branch.shape[-1] == a.shape[-1]
                            and ('residualLayers' not in topology or li in topology['residualLayers']))
                a = a + float(topology['residualScale']) * branch if residual else branch
                if li < len(self.layers) - 1:
                    memories.append(a)
            return a
    return RoutedValueNet().to(device)
