#!/usr/bin/env python3
"""CPU regression: inheritance, route parity, gradients and legacy topology compatibility."""
import importlib.util, json, os, subprocess, sys, tempfile
import torch
import torch.nn as nn
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    mod = importlib.util.module_from_spec(spec); sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main():
    torch.set_num_threads(1)
    grow = load('grow_train', 'grow-train.py')
    arch = load('deep_arch', 'deep-architectures.py')
    torch.manual_seed(123)
    probes = torch.randn(12, grow.N) * 0.4
    with tempfile.TemporaryDirectory() as folder:
        for scale in (None, 0.0, 0.2):
            topo = None if scale is None else {'kind': 'dense-memory-v1', 'memoryWidth': 3, 'residualScale': scale}
            sizes = [grow.N] + [12] * 3 + [1]
            fi = grow.fan_ins_for(sizes, topo)
            parent_layers = [nn.Linear(fi[i], sizes[i+1]) for i in range(len(fi))]
            parent_net = grow.build_model(torch, nn, parent_layers, topo, 'cpu')
            parent = grow.core.export_for_netjs(parent_layers, topology=topo)
            # Test the untouched legacy export as well as each new topology, including widened parents.
            cases = [('legacy', parent_layers, sizes, topo)]
            for style in arch.STYLES:
                layers, new_sizes, new_topo = arch.make(torch, nn, grow, parent, 16, 16, style)
                model = grow.build_model(torch, nn, layers, new_topo, 'cpu')
                if style != 'plain':
                    drift = (model(probes) - parent_net(probes)).abs().max().item()
                    assert drift < 1e-6, (style, scale, drift)
                assert [l.in_features for l in layers] == grow.fan_ins_for(new_sizes, new_topo)
                # Exercise backprop through routed packets and make them nonzero before JS parity.
                opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
                opt.zero_grad(); model(probes).square().mean().backward(); opt.step()
                assert all(torch.isfinite(p).all() for p in model.parameters())
                cases.append((style, layers, new_sizes, new_topo))
            for style, layers, shape, topology in cases:
                net = grow.build_model(torch, nn, layers, topology, 'cpu')
                def predict(x):
                    with torch.no_grad():
                        return float(net(torch.tensor([x], dtype=torch.float32))[0, 0])
                doc = grow.core.export_for_netjs(layers, probes.tolist(), predict, topology)
                file = os.path.join(folder, style+'.json'); grow.write_model(doc, file)
                subprocess.run(['node', os.path.join(HERE, 'verify-torch-export.js'), file], check=True,
                               stdout=subprocess.DEVNULL)
            print(f'PASS inheritance + post-training Python/JS forward/value parity: parent residualScale={scale}')
        # Parameter counts for the actual 400x10 dense-memory parent used in this experiment.
        shape = [grow.N] + [400] * 10 + [1]
        topo = {'kind': 'dense-memory-v1', 'memoryWidth': 40, 'residualScale': 0.2}
        fi = grow.fan_ins_for(shape, topo)
        parent_layers = [nn.Linear(fi[i], shape[i+1]) for i in range(len(fi))]
        parent = grow.core.export_for_netjs(parent_layers, topology=topo)
        for style in arch.STYLES:
            layers, _, _ = arch.make(torch, nn, grow, parent, 400, 26 if style == 'plain' else 22, style)
            count = sum(p.numel() for l in layers for p in l.parameters())
            assert 3_300_000 <= count <= 4_300_000, (style, count)
            print(f'{style}: {count:,} parameters')
    print('All deep experiment regression checks passed.')


if __name__ == '__main__':
    main()
