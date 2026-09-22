"""Outward evaluation of a CONDITIONAL local error allocation, not engine errors."""
import json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'arm2-bounds'))
from interval_core import V
m=V(1.16);p=V(.15);delta=V(1e-9);eta=V(1e-9);rho=V(1e-9)
bound=delta/(m-eta)+p*eta/(m*(m-eta))+rho
assert bound.hi<2e-9<1e-8
out={'scope':'Conditional allocation only; delta, eta and rho are assumptions, not established engine bounds.', 'm':m.lo,'penetrationUpper':p.hi,'delta':delta.hi,'eta':eta.hi,'rho':rho.hi,'localEuclideanErrorUpper':bound.hi,'demonstratedCoordinateBudget':1e-8}
(HERE/'budget-allocation.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
