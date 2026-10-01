"""Exact and high-precision controls for new propagation operations."""
from decimal import Decimal as D, getcontext
from fractions import Fraction as Q
import reply_jet as j
import reply_zonotope as z
import free_motion as f
getcontext().prec=80

# The lifted positive-part family encloses the scalar function, including both
# kink endpoints, over asymmetric domains and a nonzero input centre.
cases=[(-3.,2.),(-.01,.003),(-1e-12,1e-11)]
for lo,hi in cases:
    c=(lo+hi)/2;h=max(j.maxabs(f.V(lo)-c),j.maxabs(f.V(hi)-c))
    j.H=[h,0,0];j.COUNTS={}
    a=j.J(f.V(lo,hi),[f.V(1),f.V(0),f.V(0)],f.V(c));b=j.positive(a)
    assert len(j.H)==4
    # Independently verify the exact-rational lifting inequality using the
    # proposal slope, not the interval implementation's return values.
    alpha=max(0.,min(1.,hi/(hi-lo)))
    upper=max((-f.V(alpha)*lo).hi,((1-f.V(alpha))*hi).hi)
    for k in range(101):
        t=Q(lo)+(Q(hi)-Q(lo))*k/100
        gap=max(Q(0),t)-Q(alpha)*t
        assert 0<=gap<=Q(upper)
        target=max(Q(0),t)
        assert Q(b.v.lo)<=target<=Q(b.v.hi)

# In the smooth case, value, centre and derivative bounds are all exercised.
j.H=[.125,.0625,0];j.COUNTS={}
x=j.J(f.V(1.875,2.125),[f.V(1),f.V(0),f.V(0)],f.V(2))
y=j.J(f.V(2.9375,3.0625),[f.V(0),f.V(1),f.V(0)],f.V(3))
q=(x*x+y*y).sqrt()/x
for a in [D('1.875'),D(2),D('2.125')]:
    for b in [D('2.9375'),D(3),D('3.0625')]:
        value=(a*a+b*b).sqrt()/a
        gx=-b*b/(a*a*(a*a+b*b).sqrt());gy=b/(a*(a*a+b*b).sqrt())
        for expected,interval in [(value,q.v),(gx,q.g[0]),(gy,q.g[1])]:
            assert D.from_float(interval.lo)<=expected<=D.from_float(interval.hi)

# Initial rotation family: compare selected angles with high-precision geometry
# without reusing the interval trigonometric routines.
import decimal_reply as d
c,M=z.initial_family(8,8.01);box,h=z.box_of(c,M)
for a in [8.,8.0025,8.005,8.0075,8.01]:
    pose=d.rotate(d.SEED[:3],1,d.F(a))
    for v,b in zip(pose,box):assert D.from_float(b.lo)<=v<=D.from_float(b.hi)
# Anti-correlated coordinates must retain their exact cancellation. This checks
# the new columnwise geometric bound, independently of the contact solver.
j.H=[1.,1.,0.];j.INPUT_M=[[1.,-1.,0.]]
x=j.J(f.V(1,3),[f.V(1),f.V(0),f.V(0)],f.V(2))
y=j.J(f.V(2,4),[f.V(0),f.V(1),f.V(0)],f.V(3))
total=x+y
assert total.v.lo<=5<=total.v.hi and total.v.hi-total.v.lo<1e-12
curve=x*x+y*y
for k in range(21):
    t=Q(-1)+Q(k,10);expected=(2+t)**2+(3-t)**2
    assert Q(curve.v.lo)<=expected<=Q(curve.v.hi)
print('303 exact-rational clip checks; 27 high-precision smooth-jet checks; 15 initial-family coordinates; 22 correlated-generator controls passed')
