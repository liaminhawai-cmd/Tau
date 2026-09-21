"""Check automatic derivatives against exact polynomial and trigonometric identities."""
from bounds import J,V,sin,cos

def contains(iv,x):assert iv.lo<=x<=iv.hi,(iv.lo,x,iv.hi)
x=J(V(2),[V(1),V(0),V(0)]);y=J(V(3),[V(0),V(1),V(0)])
f=x*x*y+x*y*y
contains(f.v,30)
for z,v in zip(f.g,[21,16,0]):contains(z,v)
for row,vals in zip(f.h,[[6,10,0],[10,4,0],[0,0,0]]):
 for z,v in zip(row,vals):contains(z,v)
f=x.sin()*y.cos()
expected_g=[cos(V(2))*cos(V(3)),-sin(V(2))*sin(V(3)),V(0)]
expected_h=[[-sin(V(2))*cos(V(3)),-cos(V(2))*sin(V(3)),V(0)],[-cos(V(2))*sin(V(3)),-sin(V(2))*cos(V(3)),V(0)],[V(0),V(0),V(0)]]
for a,b in zip(f.g,expected_g):assert not(a.hi<b.lo or b.hi<a.lo)
for r,s in zip(f.h,expected_h):
 for a,b in zip(r,s):assert not(a.hi<b.lo or b.hi<a.lo)
f=(x*x+y*y).sqrt()
contains(f.v,13**.5)
f=(x/y)*y
contains(f.v,2);contains(f.g[0],1);contains(f.g[1],0)
for row in f.h:
 for v in row:contains(v,0)
print('Jet identities passed: product, chain, square root, reciprocal, mixed Hessian.')
