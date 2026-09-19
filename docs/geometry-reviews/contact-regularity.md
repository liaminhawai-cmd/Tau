Response to astra-brief.md — Tau contact regularity and swept walls

The current sample-based rule is not a mathematical certificate. There are rigorous replacements, but a contact signature and a safety factor of three do not supply their hypotheses. The useful positive results are: a stability theorem for a properly defined continuous sweeping law; a finite, although enormous, derivative bound for complete execution branches of Tau's finite solver; and an exact reduction of the swept-wall problem to one-dimensional fibres using the chosen foot's world position.

There are two particularly important corrections. Ordinary grazing does not by itself cause a discontinuity: for an isolated contact in the continuous law, the apparent inverse-incidence singularity cancels. Also, a fixed contact sequence does not make the margin differentiable, because the identity of the outermost foot can change without any contact at all.

I read the attached brief and inspected [Tau's index.html at commit 76591b521d4e7303111958f938373caf6454607a](https://github.com/liaminhawai-cmd/Tau/blob/76591b521d4e7303111958f938373caf6454607a/index.html), particularly `CFG`, `Piece`, `segClosest3`, `arcClosest`, `resolvePush`, `crossingSubstep`, and `applySwing`. All assertions below about repository behaviour refer to this commit. I have not changed the game.

**Scope and notation.** Put

\[
 u=(x,y,z),\qquad z=R\theta,\qquad
 \beta=I/R^2=0.7,\qquad W=\operatorname{diag}(1,1,\beta).
\]

Write \(|v|_W^2=v^TWv\), and use an unwrapped angle locally. Let \(e(\eta)=(\cos\eta,\sin\eta)\), \(J(x,y)=(-y,x)\), and \(b_k=2\pi k/3\). Define

\[
 P(u)=\max_k|c+Re(\theta+b_k)|,
 \qquad c=(x,y).
\]

Thus \(M=\max_\alpha P(F_\alpha)-(E+0.5)\). The pivot label and swing direction are fixed unless explicitly varied. Derivatives of a discrete pivot label are not defined.

There are three different objects to keep separate:

1. The ideal continuous minimum-motion sweeping process.
2. The real-arithmetic version of the specified finite program, with 12 chords, a specified substep schedule and ten solver passes.
3. Floating-point execution of that program.

The analytical estimates below concern 1 or 2 as stated. A bit-level certificate for 3 must also bound rounding and branch comparisons. The 200-run validation in the brief is useful empirical evidence, but it is not a uniform error enclosure relating these objects.

**A preliminary correction to the projection claim.** The stated slide/spin formula is exactly the minimiser of a *linearised* contact correction. With \(a=h_f(n_x,n_y,r_n/R)\), it solves

\[
 \min_{\Delta u}\frac12\Delta u^TW\Delta u
 \quad\text{subject to}\quad a^T\Delta u\ge\mathrm{gap},
\]

and therefore

\[
 \Delta u=\frac{\mathrm{gap}\,W^{-1}a}{a^TW^{-1}a}.
\]

For finite rotation, the exact displacement of a material point is \(\Delta c+(\operatorname{Rot}_{\Delta\theta}-I)r\). Its difference from \(\Delta c+\Delta\theta Jr\) has norm at most \(|r|\Delta\theta^2/2\). Consequently the formula is not, in general, the exact nearest-point projection onto the nonlinear nonpenetration set. Iterating it can approximate that projection or a sweeping law; the equivalence needs a separate argument.

The repository makes another distinction relevant to certification: it caches all opponent arcs and its hub at the start of each solver pass, then uses those cached contact locations during the pass while updating the opponent pose after each correction. There are at most 15 such cached-geometry corrections and one current hub–hub correction per pass. Thus its operations are not a sequence of exact projections onto freshly recomputed nonlinear constraints.

The denominator floor \(\max(h_f,0.35)\) also does **not** establish the geometric inequality \(h_f\ge0.35\). A contact with \(h_f=0.1\) is still processed; its direction is normalised using the actual horizontal component. Continuous-law theorems assuming a geometric lower bound require that bound to be verified, rather than inferred from the floor.

**Question 1(a): continuity, kinks and jumps.**

For the finite program, a complete execution branch records more than leg-pair identities: every closest-chord choice, endpoint/interior clamp, hub contact, guard decision, pass termination and substep decision. On an open region with a fixed complete branch, all output poses are smooth functions of the input, in real arithmetic. Their finite maximum of foot radii is continuous and locally Lipschitz, but need not be differentiable.

At a boundary shared by branches, the exact criterion is equality of their limiting output values. If the limiting margin values agree, the margin is continuous there; if they disagree, it jumps. A jump in the endpoint pose need not produce a jump in the maximum radial margin. This criterion can be checked on the explicit branch formulae; contact labels alone cannot decide it.

Potential branch boundaries include:

| Event | What follows mathematically |
| --- | --- |
| A single ordinary contact first becomes penetrating | Its correction tends to zero. This event alone does not create a jump. |
| Outermost foot or maximising time changes | A maximum of continuous functions remains continuous; a kink is possible. |
| Closest point passes through a shared polyline vertex | A derivative can change. A jump is not forced if the closest points have the same limit. |
| Two distinct closest-point candidates tie | Different selected normals or lever arms can give different finite corrections. Matching must be checked. |
| The separation cap or the 0.35 denominator floor activates | The clipping operation itself is continuous, usually with a derivative kink. |
| The deep-overlap direction rule, its sign, or the horizontal-normal drop rule changes | These are hard switches; their limiting corrections need not agree. |
| The near-parallel branch in `segClosest3` changes | The implementation uses a positive denominator threshold; continuity of the selected contact data is an additional question. |
| The mover's accepted final substep changes | The endpoint of the finite program can jump if the additional step produces nonzero motion. This matters when the mover varies. |

These are candidate mechanisms, not an assertion that every branch surface is reachable from a feasible initial pose, or that every one produces a jump in \(M\). I have not established a global list of reachable jump surfaces for this game. In particular, I am not claiming an actual discontinuity of the continuous tripod dynamics merely from a generic hybrid-system analogy.

For the ideal continuous law, continuity follows under the uniform regularity hypotheses proved below. Those hypotheses permit changes in the active contacts. Loss of uniqueness or of the regularity of the feasible set needs separate analysis; the brief's signature does not test either property.

**An exact tripod counterexample to differentiability with a fixed contact sequence.** Take the pushed tripod at

\[
 q=(30,0,\pi/3)
\]

and the mover at \((-30,0,\pi)\), pivoting about its leg-0 foot \((-53.095,0)\), in either direction. Throughout this circular hub path, the mover's hub has \(x\le-30\). The hub separation in the x direction is at least 60, greater than \(2R+2\rho=49.07\), so the tripods cannot touch. The mover's legality rules can only shorten this path. Both initial tripods have all feet on the board.

Two pushed feet, at \((41.5475,\pm20.0008567\ldots)\), tie for the maximum radius \(46.1110510\ldots\). As \(z=R\theta\) passes through this pose, the two candidate radii have angular-coordinate derivatives

\[
 \pm\frac{30\sin(\pi/3)}{46.1110510\ldots}
 =\pm0.56343895\ldots.
\]

Their maximum has a kink. The entire contact sequence is empty on a neighbourhood. Thus even the strongest possible knowledge of the contact sequence does not give a classical gradient everywhere, much less a classical Hessian of \(M\).

**Useful exact constants for the radial observable.** A labelled foot position is \(\sqrt2\)-Lipschitz in \(u\). For the *outermost-foot radius* the smaller, globally sharp constant is

\[
 \boxed{\operatorname{Lip}_u P\le\frac{\sqrt7}{2}
 =1.32287566\ldots.}
\]

To prove it, let \(d=|c|\), and let \(\delta\) be the angle between \(c\) and a currently farthest leg. Then \(|\delta|\le\pi/3\), and on that smooth branch

\[
 |\nabla_u P|^2
 =1+\frac{d^2\sin^2\delta}{d^2+R^2+2dR\cos\delta}
 \le1+\frac34.
\]

The bound survives ties by continuity and the maximum rule. It is approached as \(d\to\infty\), \(|\delta|\to\pi/3\) from a uniquely maximising side; hence it is sharp on unrestricted pose space. It need not be sharp on the board. If \(|c|\le C\), the sharp supremum on that hub-bounded domain is

\[
 L_P(C)=\sqrt{1+\frac{3C^2}{4(C^2+RC+R^2)}}.
\]

In the mass norm the corresponding unrestricted constant is

\[
 \boxed{L_{P,W}=\sqrt{1+\frac{3}{4\beta}}
 =\sqrt{\frac{29}{14}}=1.43924583\ldots.}
\]

For any two trajectories on a common time interval,

\[
 |M_1-M_2|
 \le L_{P,W}\sup_\alpha|F_{1,\alpha}-F_{2,\alpha}|_W.
\]

This follows directly from \(|\max f-\max g|\le\max|f-g|\). It needs neither a unique outermost foot nor a unique maximising time.

**Question 1(b), continuous law: what grazing actually does.** In mass coordinates \(y=W^{1/2}u\), let \(g(y,\alpha)\ge0\) be a smooth isolated gap constraint. At an active contact set \(a=\nabla_y g\). The minimum-motion contact velocity is

\[
 \dot y=f=-\frac{g_\alpha}{|a|^2}a
 \quad\text{when }g_\alpha<0,
\]

and zero when the body is free. At a transverse first contact, differentiating the event time gives \(d\tau=-a^Tdy^-/g_\alpha\). At the same observation time, the resulting first variation is

\[
 dy^+=dy^- - f\,d\tau
 =\left(I-\frac{aa^T}{|a|^2}\right)dy^-.
\]

Thus the contact-onset sensitivity is an orthogonal projection of norm 1 in mass coordinates. The small incidence rate cancels. At an ordinary release, the contact velocity tends to zero and there is no nontrivial first-variation jump. At exact grazing the transverse event-time derivation is unavailable, but its apparent denominator is not evidence of divergence. Continuity at grazing can instead be obtained from the feasible-set stability theorem below.

For context, event-time sensitivity is usually expressed through a saltation matrix; see [Kong, Payne, Zhu and Johnson, 2024](https://arxiv.org/abs/2306.06862). The cancellation above is a direct calculation for the first-order law in this brief, rather than a conclusion imported from second-order impact dynamics.

On a smooth contact branch, if

\[
 |a|\ge h_0,\quad |g_\alpha|\le B,
 \quad|\nabla_y g_\alpha|\le G,
 \quad\|\nabla_y^2g\|\le H_g,
\]

then

\[
 \|D_yf\|\le G/h_0+BH_g/h_0^2.
\]

Indeed the derivative of \(a/|a|^2\) with respect to \(a\) is \((I-2\hat a\hat a^T)/|a|^2\), whose norm is \(1/|a|^2\). Integrating this bound between events, with the actual event sensitivity factors, gives a conventional local variational bound. Treating a leg-pair label as a fixed material contact point would give the wrong derivatives: the minimising locations slide along both legs.

A useful speed bound has a better constant than \(2R\). Every mover centreline point lies at horizontal distance at most \(\sqrt3R\) from a chosen foot. Its normal velocity is therefore at most \(\sqrt3R\) per radian. For a single contact, the horizontal fraction cancels from the velocity formula, giving

\[
 |\dot u|_W\le\sqrt3R=40.0017134\ldots.
\]

This is a speed bound, not an initial-condition derivative bound.

**A continuous-law stability theorem that also handles changing contacts.** Use every material-point pair as an inequality, rather than differentiating the identity of the closest pair. Let \(C(\alpha)\) be the exact feasible set in mass coordinates, and interpret the continuous law as

\[
 -\dot y\in N_{C(\alpha)}(y),\qquad y\in C(\alpha).
\]

This is the minimum-velocity sweeping interpretation. It is an additional specification of simultaneous-contact behaviour, not a proved equivalence to ten sequential passes of the finite solver.

Assume the following hold uniformly along all trajectories in the region being certified:

* Every active material-point gap has geometric horizontal fraction at least \(h_0>0\).
* For their inward gradients \(a_i\), and all nonnegative coefficients, a constant \(\Gamma\) satisfies

\[
 \sum_i\lambda_i|a_i|
 \le\Gamma\left|\sum_i\lambda_i a_i\right|.
 \tag{1}
\]

This rules out arbitrarily strong cancellation of simultaneously active normals. It is a uniform constraint qualification; the analogous statement for measures covers continuous contact sets. For a single active normal, \(\Gamma=1\).

Under these assumptions a valid uniform prox-regularity radius is

\[
 \boxed{r_* =\frac{h_0}{\Gamma H_*},\qquad
 H_* =\frac{1+1/\beta}{2\rho}+\frac1{\beta R}.}
 \tag{2}
\]

Here is a direct derivation. A pushed material point has differential norm at most \(\sqrt{1+1/\beta}\) in mass coordinates and a rotational Taylor remainder at most \(|\Delta y|^2/(2\beta R)\). At an active pair with separation \(d_*\ge2\rho\), the elementary inequality

\[
 |v+w|\le |v|+\hat v\cdot w+\frac{|w|^2}{2|v|}
\]

therefore gives, for its gap,

\[
 g(y')\le g(y)+a\cdot(y'-y)+\tfrac12H_*|y'-y|^2.
\]

Since both configurations are feasible and \(g(y)=0\),

\[
 -a\cdot(y'-y)\le\tfrac12H_*|y'-y|^2.
\]

An outward normal is \(v=-\sum_i\lambda_i a_i\). Using \(|a_i|\ge h_0\) and (1),

\[
 v\cdot(y'-y)
 \le\frac{|v|}{2r_*}|y'-y|^2.
 \tag{3}
\]

This is the normal inequality needed for the stability estimate. The constraint qualification also supplies the usual normal representation and local regularity of the intersection. General existence and uniqueness theory for moving prox-regular sets is discussed, for example, in [Recupero, 2024](https://arxiv.org/abs/2407.09354).

For two solutions driven by the same mover, apply (3) to \(-\dot y_1\) and \(-\dot y_2\). With \(e=y_1-y_2\),

\[
 \frac d{d\alpha}\frac{|e|^2}{2}
 \le\frac{|\dot y_1|+|\dot y_2|}{2r_*}|e|^2.
\]

Consequently

\[
 |e(\alpha)|
 \le\exp\!\left(\int_0^\alpha
 \frac{|\dot y_1|+|\dot y_2|}{2r_*}\,dt\right)|e(0)|.
 \tag{4}
\]

A speed bound valid for simultaneous contacts is

\[
 V=\sqrt{(3R+2\rho)^2+I}.
\]

To see this, make the pushed body instantaneously co-rotate with the mover about the mover's pivot. This preserves every relative separation, so it is a feasible velocity. At any contact the hub separation is at most \(2R+2\rho\); the pushed hub is therefore at most \(3R+2\rho\) from that pivot. The minimum-norm feasible velocity cannot be larger. With no active contact the velocity is zero.

For a common finite horizon \(T=\alpha_{\rm end}\), (4) gives

\[
 \boxed{\operatorname{Lip}_u M
 \le\sqrt{1+\frac3{4\beta}}\exp(VT/r_*),}
 \tag{5}
\]

\[
 \boxed{\operatorname{Lip}_u F_T
 \le\beta^{-1/2}\exp(VT/r_*).}
 \tag{6}
\]

These are rigorous under the stated hypotheses, including across contact changes and at nondifferentiable margin points. Numerically, \(H_*=0.9051103\ldots\), \(r_*=0.3866932\ldots/\Gamma\) for \(h_0=0.35\), and \(V=74.70711\ldots\). The exponential in (5) is at most the bound \(\exp(193.1948\ldots\Gamma T)\). For trajectories having at most one active normal throughout, use \(\Gamma=1\) and the smaller speed \(\sqrt3R\), giving \(\exp(103.4456\ldots T)\).

These estimates are extremely loose. Their value is identifying sufficient hypotheses and proving continuity, not explaining observed slopes near one. Neither the normal-angle condition (1) nor the actual lower bound on \(h_f\) follows from the recorded signature. I have not proved a global \(\Gamma\) for all feasible tripod configurations, and I have not proved that no such constant exists. A denominator becoming small in one derivation is not a counterexample to a stronger theorem.

**Question 1(b), finite solver: an explicit, deliberately crude branch bound.** The repository's positive numerical cutoffs allow a finite bound on the derivative of every complete smooth execution branch. This is useful for distinguishing “no useful small bound is established” from “no finite bound can exist”. The latter would be an incorrect conclusion for an individual complete branch of this bounded finite computation.

The following constants bound the real-arithmetic program in the pinned source. They use the actual 12-chord geometry and guards. Set

\[
 \ell=2R\sin(\pi/48),\quad Q=4R+3.8\rho,
 \quad\varepsilon=10^{-12},\quad d_0=10^{-6},
\]
\[
 h_d=10^{-4},\quad h_c=0.35,\quad c_*=0.8.
\]

Define

\[
 A_s=\frac{8\ell^2Q+4\ell^3}{\varepsilon}
       +\frac{16\ell^6Q}{\varepsilon^2},\qquad
 K_s=A_s+\frac{2Q+6\ell}{\ell^2},
\]
\[
 P_*=\sqrt2(3+\ell K_s),\qquad
 C_n=\frac{2P_*}{d_0h_d},\qquad
 C_s=\frac{2P_*}{h_c}
       +\frac{4(3.8\rho)P_*}{h_c^2d_0},
\]
\[
 K_\beta=\beta^{-1/2}+\beta^{-1},\quad
 Z=1+16c_*/R,\quad
 A=1+c_*K_\beta/R,
\]
\[
 B=C_s+c_*\left[(1+K_\beta Z)C_n+K_\beta P_*/R\right],
\]
\[
 \boxed{L_{\rm pass}=(1+c_*/d_0)
 \left[A^{15}+B\frac{A^{15}-1}{A-1}\right].}
 \tag{7}
\]

If the swing accepts \(N\) movement substeps, then on a convex cell contained in one complete smooth execution branch,

\[
 \boxed{\operatorname{Lip}F\le L_{\rm pass}^{10N},\qquad
 \operatorname{Lip}M\le\frac{\sqrt7}{2}L_{\rm pass}^{10N}.}
 \tag{8}
\]

For a canonical schedule of 0.4° steps plus a possible final remainder, \(N\le\lceil T/(0.4\pi/180)\rceil\). The caller's subdivision schedule must be fixed: `applySwing` subdivides each supplied angle, so arbitrary different caller schedules are different finite maps.

Proof of (7)–(8):

1. Each chord has length \(\ell\). In a closest-segment calculation, write the numerator as \(bf-c\ell^2\) and denominator as \(\ell^4-b^2\). If each endpoint changes by at most \(\eta\), then \(|Db|\le4\ell\eta\), \(|Dc|,|Df|\le2(Q+\ell)\eta\), and \(|D(\ell^4-b^2)|\le8\ell^3\eta\). On the division branch the denominator exceeds \(\varepsilon\), giving \(A_s\). The clamped and endpoint branches give the additional term in \(K_s\). A selected point therefore changes by at most \((3+\ell K_s)\eta\). Rigid-pose endpoint sensitivity is at most \(\sqrt2\), giving \(P_*\). The point-to-chord formula is bounded by the same constant.
2. The bound \(Q\) is needed only for selected contact data actually used in a correction. Such a contact puts the cached hubs within \(2R+3.8\rho\), so the relevant endpoint separation is at most \(4R+3.8\rho\). Queries returning no correction do not enter the output derivative on a fixed branch.
3. For a retained ordinary contact, \(d>d_0\) and actual \(h_f\ge h_d\). The horizontal separation is at least \(d_0h_d\), giving \(|Dn|\le C_n\). Differentiating \(\min((\delta-d)/\max(h_f,h_c),c_*)\), with \(\delta\le3.8\rho\), gives \(|D\mathrm{sep}|\le C_s\). The deep-overlap branch has fixed mover-derived direction on a fixed sign branch and constant capped separation, so this upper bound also covers it.
4. Put \(t=r_n/R\). The pose correction is \(\Delta u=\mathrm{sep}\,a(t,n)\), where

\[
 a(t,n)=\left(\frac{\beta n}{\beta+t^2},
                    \frac{t}{\beta+t^2}\right).
\]

For \(\beta=0.7\), \(|a|\le1\). In fact

\[
 |a|^2=\frac{\beta^2+t^2}{(\beta+t^2)^2}\le1
\]

because \(\beta\ge1/2\); equality holds at \(t=0\). This is the sharp unit gain from demanded horizontal separation to scaled pose displacement. Also \(|D_ta|\le K_\beta\).
5. Within a pass, cached points have derivative at most \(P_*\), while the current pose derivative, denoted \(J_*\), grows. Since each translation is at most \(c_*\), \(|r|/R\le Z\). Thus

\[
 |Dt|\le(P_*+J_*)/R+ZC_n,
 \qquad J_*^{\rm new}\le A J_*+B.
\]

There are at most 15 cached corrections, starting from \(J_*=1\), which gives the bracket in (7).
6. The last, current hub–hub correction is radial translation with separation capped at \(c_*\). Its radial derivative has magnitude at most 1 and its transverse derivative at most \(1+c_*/d_0\). This gives the prefactor in (7). Compose ten passes per accepted step and all \(N\) steps. Every prefix has the same upper bound. Apply the radial-observable bound to obtain (8).

Numerically, \(\log_{10}L_{\rm pass}\approx48.991\). Thus (8) is approximately a \(10^{490N}\) bound. It is intentionally unusable as a practical certification radius. It does prove a finite branchwise bound from the actual fixed program constants. Much smaller certified bounds require evaluating derivative enclosures on the specific cell, with its actual distance and feature-separation margins.

Equation (8) bounds the maximum over computed poses. It also covers a maximum over piecewise linear interpolation in unwrapped scaled pose, since each interpolated pose has a convex combination of the endpoint Jacobians. A different interpretation of motion between discrete updates needs to be specified and bounded separately.

Crucially, (8) does **not** bridge a branch boundary with unequal limiting values. Nor does a fixed deepest-leg-pair signature imply that a cell stays inside one execution branch. No-contact maximum-foot changes are harmless for its Lipschitz conclusion, although they defeat classical differentiability.

**The proposed curvature rule needs a dimension factor.** As written,

\[
 \sup_C|\nabla M|\le S+\kappa h,
 \qquad S=\max\text{ axis finite-difference slope},
 \tag{9}
\]

cannot hold with a fixed finite \(\kappa\), even locally in a smooth region of this exact geometry.

For an explicit example, put the pushed tripod at \((30,10,0)\), and the mover at \((-30,-10,\pi)\), pivoting about leg 0. The same x-separation argument proves that they never touch. The uniquely outermost pushed foot is \((53.095,10)\), so

\[
 \nabla_u M
 =\frac{(53.095,10,10)}{\sqrt{53.095^2+10^2}}.
\]

Its norm is \(1.01698445\ldots\), whereas its largest coordinate magnitude is \(0.98272205\ldots\). As a grid cell shrinks around this pose, \(S\) tends to the latter number and \(\kappa h\) tends to zero. This contradicts (9) for every fixed finite \(\kappa\).

For a scalar affine function in three dimensions the necessary worst-case conversion is \(\sqrt3S\). This factor is sharp in general, when the three coordinate slopes have equal magnitude; this does not assert that the affine worst case is realised by every tripod region.

A useful sufficient replacement is available when \(M\) is \(C^2\) throughout a cube of side \(h\), all twelve edge differences are included, and

\[
 \|\nabla^2M\|\le K.
\]

Then

\[
 \boxed{\sup_C|\nabla M|\le\sqrt3S+\sqrt{5/2}\,Kh.}
 \tag{10}
\]

For each coordinate and each interior point, choose the parallel cube edge whose other two coordinates are nearest. Its finite difference is the average directional derivative on that edge. The mean squared distance from the point to the edge parameter is at most \(h^2/2+h^2/3=5h^2/6\). The Hessian bound and Cauchy–Schwarz bound each component's discrepancy by \(K\sqrt{5/6}h\); combining three components proves (10). The remainder constant is convenient, not claimed optimal.

Consequently \(3S\) would be justified by this particular argument if

\[
 Kh\le0.80192148\ldots S.
\]

The condition must be proved over the cell. Matching samples do not prove it. It also cannot be applied across the outermost-foot kink above. A direct Lipschitz or interval enclosure avoids requiring a classical Hessian of the maximum.

For certification, use a proved \(L\), a covering radius \(r\), and a rigorous numerical error allowance \(\epsilon\). A sample certifies its covered region as thrown when \(M_{\rm sample}-\epsilon-Lr>0\), and as not thrown when \(M_{\rm sample}+\epsilon+Lr\le0\). For vertices of a cubic lattice in the stated coordinates, \(r=\sqrt3h/2\). Cells that cannot be enclosed remain undecided.

**Question 1(c): carrying boxes through a push.** The same flow or execution-branch derivative bounds apply to \(F\). For a convex input box with centre \(u_0\), half-widths \(r_j\), and verified bounds

\[
 \left|\frac{\partial F_i}{\partial u_j}\right|\le B_{ij}
 \quad\text{throughout the box},
\]

the output is contained in the box centred at \(F(u_0)\) with half-widths

\[
 \boxed{r_i'=\sum_j B_{ij}r_j+\epsilon_i.}
\]

This is the integral mean-value formula applied along each segment from the centre. The third output coordinate is \(R\theta\); divide its half-width by \(R\) if reporting angles. Use an unwrapped chart or split a box crossing an angular seam. A centre Jacobian alone is not an enclosure. If branch decisions are unresolved, split the input or enclose every possible branch and take their union or hull.

For a simple norm-based enclosure, (6) or (8) supplies an output ball; a containing axis-aligned box follows immediately. This can be much wider than the componentwise construction.

**Question 1(d): mover pose, moving pivot and composed moves.** A rotation by signed angle \(\sigma s\), \(\sigma\in\{-1,1\}\), about the body's own foot \(k\) is exactly

\[
 \Phi_{\sigma s}(c,\theta)
 =\left(c+R[e(\theta+b_k)-e(\theta+\sigma s+b_k)],
                    \theta+\sigma s\right).
 \tag{11}
\]

It is not rotation about a world point held fixed while the initial pose varies. Its scaled-pose Jacobian is a shear:

\[
 D_u\Phi_{\sigma s}=
 \begin{pmatrix}I_2&Je(\theta+b_k)-Je(\theta+\sigma s+b_k)\\0&1\end{pmatrix}.
\]

The exact operator norm is

\[
 \boxed{\|D_u\Phi_{\sigma s}\|
 =\sqrt{1+\sin^2(s/2)}+|\sin(s/2)|\le1+\sqrt2.}
 \tag{12}
\]

Also \(|d\Phi_{\sigma s}/ds|=\sqrt2R\) in the stated pose metric. Thus \(2R|\Delta s|\) is conservative for the active body's own rigid-pose displacement, but it does not account for the other body's simultaneous displacement.

Write the response margin as \(M(q,a)\), with \(q\) the pushed initial pose and \(a\) the mover initial pose, including its own-foot pivot dependence. For the family produced by a preceding move,

\[
 \frac d{d\lambda}M(q(\lambda),a(\lambda))
 =D_qM\,q'(\lambda)+D_aM\,a'(\lambda)
\]

where differentiable. A valid Lipschitz estimate is

\[
 |\Delta M|\le\int
 \big[L_q|q'|+L_a|a'|\big],d\lambda.
 \tag{13}
\]

The omitted mover term can be nonzero even when the counted pushed displacement is zero. It is not controlled by measuring only \(q\). For a whole preceding transition \(H\), the exact derivative is the block chain rule \(D(M\circ H)=D_qM\,DH_q+D_aM\,DH_a\).

There is also a horizon term. If \(T=T(a)\),

\[
 D_aF(q,a,T(a))=\partial_aF+F_\alpha\,D_aT.
\]

For the maximum margin, reparameterise time as \(\alpha=\tau T(a)\), \(0\le\tau\le1\); the same extra term, with factor \(\tau\), appears in every candidate observable. An ideal stopping root \(H(a,T)=0\) has \(D_aT=-H_a/H_\alpha\) when transverse. Near a tangent stopping event, or when the relevant line event changes, this needs separate treatment. In the finite program, accepted-step count is a discrete branch and can change discontinuously.

**Question 2: coordinates that make the sweep simple.** Fix foot \(k\), and replace hub position by the chosen foot's world position

\[
 w=c+Re(\theta+b_k).
\]

The inverse transformation is

\[
 \boxed{\Psi_k(w,\theta)=(w-Re(\theta+b_k),\theta).}
 \tag{14}
\]

Under (11), \(w\) is constant and \(\theta\) changes by \(\sigma s\). This transformation exactly handles the pose dependence of the pivot.

For clarity take \(\sigma=+1\) below; for the other direction replace the increasing angle coordinate by \(-\theta\). Work on angular lifts and reduce modulo \(2\pi\) at the end. Use the exact minimum duration \(s_0=\pi/90\), rather than the rounded 0.035.

If \(D=[x_-,x_+]\times[y_-,y_+]\times[\theta_-,\theta_+]\), then its fibre at fixed \(w\) is the finite union of intervals defined by

\[
 \theta\in[\theta_-,\theta_+],\quad
 x_-\le w_x-R\cos(\theta+b_k)\le x_+,\quad
 y_-\le w_y-R\sin(\theta+b_k)\le y_+.
 \tag{15}
\]

Call this set \(D_w\), including necessary periodic copies. Its endpoints are obtained by arccos/arcsin and interval intersection, with no angular grid.

For a starting angle \(\theta\), let \(A_w(\theta)\) be the set of forward endpoint angles that can be reached without contact and within the legal swing prefix. This is an interval starting at \(\theta\), with open or closed endpoint according to the actual blocking condition. Then the exact membership test is

\[
 \boxed{\Psi_k(w,\theta)\in T
 \iff D_w\cap[\theta+s_0,\infty)\cap A_w(\theta)\ne\varnothing.}
 \tag{16}
\]

The remainder of this answer gives explicit ways to construct these intervals and their envelope surfaces, so (16) does not require sampling a swing or treating a maximum legal angle as an unexplained numerical oracle.

There is a finite search horizon even when a central spin has no geometric limit. For a prefix-closed legality rule, any witness of duration \(s\ge s_0+2\pi\) can be shortened by complete turns to one in \([s_0,s_0+2\pi)\), retaining the same endpoint pose and a legal collision-free prefix. This uses the pose space \(\mathbb R^2\times S^1\), and excludes extra history-dependent rules absent from the brief, such as ko.

**Circle and line events have elementary roots.** Put

\[
 v_j=R[e(b_j)-e(b_k)],\qquad
 f_j(w,\theta)=w+\operatorname{Rot}_\theta v_j.
\]

For the pivot \(v_k=0\); the other two vectors have length \(\sqrt3R\). A circle of centre \(C\) and radius \(a\) is met when

\[
 |f_j-C|^2-a^2=A+B\cos\theta+C_1\sin\theta=0,
\]

where

\[
 A=|w-C|^2+|v_j|^2-a^2,\quad
 B=2(w-C)\cdot v_j,\quad
 C_1=2(w-C)\cdot Jv_j.
\]

For \(L=\sqrt{B^2+C_1^2}>0\), the roots are

\[
 \boxed{\theta=\operatorname{atan2}(C_1,B)
             \pm\arccos(-A/L)+2\pi n,}
 \tag{17}
\]

provided \(|A|\le L\). When \(L=0\), the expression is constant, so the event is absent or the foot lies on the circle throughout. This covers exact centre spins without dividing by zero.

For the abstract board constraint use \(a=E\). The inspected program instead uses \(a=E+0.5\) for the mover too. Printed rings in this commit have radii 40 and 53.3; the side arcs have radius 40 and centres \((\pm66.667,0)\), with the angular spans in `CFG`. Arc endpoints add ray equations. The program's 0.81 contact bands add the radii \(a\pm0.81\), while its corner tests add circles about printed intersections. Every such test reduces to the same elementary trigonometric form or a linear trigonometric ray test.

For an ideal zero-width “at most one crossing” convention, order the transverse line roots and stop before the second charged event, treating start-on-line and simultaneous events according to the chosen rule. The phrase alone does not determine those conventions. For this repository, `crossingSubstep` is the authoritative finite-state rule; its episode and corner logic is more detailed than simply counting two roots.

To reproduce its *discrete* legality exactly, evaluate its symbolic comparisons at the mandated substep poses and propagate its finite state. This enumerates the program's prescribed steps, rather than approximating a continuous collision condition with an angle grid. A continuous event-based crossing interpretation and the source's finite-substep interpretation must not silently be substituted for each other.

**Exact contact events, including over/under and hubs.** Here are explicit generating equations for the geometric contact surfaces; they also supply a root-based membership construction. Let the fixed tripod have hub \(c_B\) and angle \(\theta_B\). For a leg pair define

\[
 a_i(\phi,\theta)=(R\sin\phi\,e(\theta+b_i),R\cos\phi),
\]
\[
 b_j(\psi)=(c_B+R\sin\psi\,e(\theta_B+b_j),R\cos\psi).
\]

For \(d=2\rho\), put

\[
 z_d=R(\cos\phi-\cos\psi),\qquad
 h=\sqrt{d^2-z_d^2}.
\]

Whenever \(|z_d|\le d\), all equality-contact candidates are generated by

\[
 \boxed{c_A=c_B+R\sin\psi\,e(\theta_B+b_j)
                -R\sin\phi\,e(\theta+b_i)+h e(\gamma).}
 \tag{18}
\]

For an interior/interior closest pair impose

\[
 h\cos\phi\cos(\gamma-\theta-b_i)-z_d\sin\phi=0,
\]
\[
 h\cos\psi\cos(\gamma-\theta_B-b_j)-z_d\sin\psi=0.
 \tag{19}
\]

These are the two tangent-orthogonality conditions. The four parameters \((\theta,\phi,\psi,\gamma)\), subject to two equations, describe two-dimensional surface patches. For an endpoint contact, fix the corresponding parameter to 0 or \(\pi/2\) and replace its stationarity condition by the appropriate one-sided minimum condition. Include all endpoint/interior combinations and degenerate tangent cases. These are constrained parametric generators; at regular points two parameters can be solved for to obtain an ordinary two-parameter chart. No claim of a single global elementary chart is needed.

For hub–leg contacts, use the same construction with one point fixed at its hub and \(d=2.9\rho\), retaining only the other leg's stationarity/endpoint condition. For hub–hub contacts the surface is simply

\[
 c_A=c_B+3.8\rho\,e(\gamma),\qquad\theta\text{ arbitrary}.
 \tag{20}
\]

A generated patch belongs to the nonpenetration boundary only where all other separation inequalities also hold. Stationary pairs that are not global minima, and portions hidden inside another forbidden contact, must be discarded. This filtering is essential.

For the 12-chord version, replace each arc by its explicit linear chord parameterisation and use the same squared-distance equations, with segment interior/endpoint conditions. This keeps the actual polygonal collision geometry.

To obtain contact angles on an orbit, substitute \(c_A=w-Re(\theta+b_k)\) in these equations. There is an exact alternative to manually resolving all stationary features: use

\[
 \cos\theta=\frac{1-t^2}{1+t^2},\quad
 \sin\theta=\frac{2t}{1+t^2},\qquad t=\tan(\theta/2),
\]

and similarly \(\tan(\phi/2),\tan(\psi/2)\in[0,1]\) for smooth quarter arcs. Split at chart poles. Squared leg distances minus the required squared thickness then become rational functions with positive denominators. Their signs and the existence of colliding parameters are polynomial inequality questions after clearing those denominators.

Real root isolation and quantifier elimination therefore determine the collision-free angle intervals exactly, including tangent roots and equality cases. For example, strict no-contact means that every material-pair squared distance is strictly greater than its threshold throughout the path. The quantifiers over path angle and material parameters express this directly. No separation guards are used here: on a collision-free swing there is no push to resolve.

This is an exact algebraic decision procedure, not a promise of a cheap elementary formula for every contact angle. Certified real constants, or exact algebraic encodings of the stated angular constants, are required at equality cases. The general algorithmic foundation is [Basu, Pollack and Roy, Algorithms in Real Algebraic Geometry](https://link.springer.com/book/10.1007/978-3-662-05355-3). An exact sign determination on an algebraic cell is different from hoping that a dense set of angular samples misses no contact.

**Envelope surfaces of the raw own-foot sweep.** First consider \(\bigcup_{s_0\le s\le S}\Phi_{-s}(D)\), with fixed finite \(S\). A candidate bounding surface from an exposed face at an endpoint is

\[
 (u,v)\longmapsto\Phi_{-s_0}(q_{\rm face}(u,v)),
 \quad\text{or}\quad
 (u,v)\longmapsto\Phi_{-S}(q_{\rm face}(u,v)).
 \tag{21}
\]

For an interior duration, a smooth face contributes an envelope only where the swing vector is tangent to the face. In hub coordinates the forward vector is

\[
 X=(R\sin(\theta+b_k),-R\cos(\theta+b_k),1).
\]

Thus the face-interior generators are

\[
 x=x_\pm,\quad\sin(\theta+b_k)=0;
 \qquad y=y_\pm,\quad\cos(\theta+b_k)=0.
 \tag{22}
\]

There is no interior-face envelope from \(\theta=\theta_\pm\), since the angular component of \(X\) is 1. For example an x-face patch is explicitly

\[
 \begin{aligned}
 x(s)&=x_\pm+R\cos a_*-R\cos(a_*-s),\\
 y(v,s)&=v+R\sin a_*-R\sin(a_*-s),\\
 \theta(s)&=\theta_*-s,
 \end{aligned}
 \tag{23}
\]

where \(a_*=\theta_*+b_k\), \(\sin a_*=0\), and \(v\in[y_-,y_+]\). The analogous y-face patch has \(\cos a_*=0\), \(y=y_\pm\), and x as the free face coordinate.

The box is not smooth. Its twelve edges also generate candidate walls

\[
 \boxed{(v,s)\longmapsto\Phi_{-s}(q_{\rm edge}(v)).}
 \tag{24}
\]

Vertex sweeps give lower-dimensional seams. Edge-generated walls can be exposed even when neither adjacent face satisfies (22): a combination of the two face normals can be perpendicular to the sweep direction. Ignoring the edges is therefore an actual omission, not a cosmetic simplification.

Equations (21)–(24) are a complete candidate description for the boundary of the raw finite sweep, with occluded patches removed. A concise proof is that an interior source point maps to an interior image point; at an interior face and interior duration, a full-rank face-plus-time differential likewise maps locally onto an open set. Boundary images can remain only at endpoint durations, rank-deficient face sweeps, or lower-dimensional source strata. With unbounded duration, use the periodic finite reduction and cancel artificial endpoint patches by the membership test.

**Clipping the walls by collision and legality.** The raw sweep is not yet \(T\): it can include starting poses whose forward path hits B, crosses too many lines, or goes off the board before entering \(D\). These conditions must be checked over the entire path.

There is an especially simple complete formula if only collision and the board boundary are imposed. For fixed \(w\), let \(J=(\ell,r)\) be a connected free-angle interval, with boundary inclusion adjusted if touching the board is allowed. If \(D_w\cap J\ne\varnothing\), let

\[
 b(w)=\sup(D_w\cap J).
\]

Then the contributing starting angles are exactly

\[
 \boxed{\theta\in J,\qquad\theta+s_0\le b(w),}
 \tag{25}
\]

with strict inequality when the supremum is not attained. To prove it, an endpoint exists after \(\theta+s_0\) precisely when the target fibre has a point that far ahead in the same free component. Holes in \(D_w\) do not matter: the swing may pass through poses outside \(D\).

The two graph walls on a regular pivot-plane patch are consequently

\[
 \boxed{w\longmapsto\Psi_k(w,\ell(w)),\qquad
        w\longmapsto\Psi_k(w,b(w)-s_0).}
 \tag{26}
\]

The first may be an excluded contact boundary; the second is the shifted latest-reachable-target wall. If the fibre exists only over a region of the pivot plane, its boundary also contributes lateral patches

\[
 \boxed{(v,t)\longmapsto\Psi_k(w_{\partial}(v),t),}
 \tag{27}
\]

for the exposed interval of \(t\). These include projection folds and box-edge effects. Testing exposure prevents internal or redundant surfaces from being called walls.

With a crossing budget, replace (25) by (16). Partition the pivot plane and angle axis at target-fibre endpoints, contact roots, board roots, line events and changes in their order or multiplicity. On each resulting cell, the line-rule state and the relevant forward blocking endpoint are fixed symbolic branches. Intersect the reachable endpoint interval with \(D_w\) and \([\theta+s_0,\infty)\). This produces a finite union of starting-angle intervals on each pivot-plane cell.

If their endpoints are \(a_j(w),b_j(w)\), the final exposed graph walls are exactly

\[
 \boxed{w\mapsto\Psi_k(w,a_j(w)),\qquad
        w\mapsto\Psi_k(w,b_j(w)),}
 \tag{28}
\]

together with exposed lateral patches (27), and their lower-dimensional seams. Here the endpoint functions are explicitly defined ordered real-root branches of the equations above, with the stated finite-state inequalities selecting the branch. Cylindrical algebraic decomposition is one way to obtain these root charts and filter them. Its graph sections and lateral boundary cells give a complete boundary description, including singular strata, without assuming that every wall is the swept image of one box face.

Useful equations for the pivot-plane discriminants are \(G(w,t)=0\), \(G_t(w,t)=0\) for tangencies, and \(G_1(w,t)=G_2(w,t)=0\) for simultaneous events, supplemented by feature endpoint and chart-boundary cases. Thus the collision and legality clipping introduces walls beyond (21)–(24), and the root-interval construction specifies where they are exposed.

No numerical \(D\), fixed pose of B, or pivot was supplied, so a numerical list of its exposed wall patches cannot be specialised further. Equations (14)–(28) give their general generators, exact selection rule and membership test.

**What these results establish for the proposed certificates.** A verified continuous feasible-set regularity bound gives (5)–(6); a verified complete finite-program branch gives (7)–(8); a verified local Hessian bound on a smooth margin branch gives (10). None is supplied by matching the brief's contact signature at sampled vertices. The combined-move certificate additionally needs both initial-pose blocks and the mover's stopping-rule dependence. The swept-wall problem can be handled exactly by pivot fibres and root isolation, independently of the push solver, because the relevant paths have no contact.

The remaining unproved issue is a useful small global regularity constant for all feasible tripod contacts, or a reachable continuous-law counterexample showing that such a constant fails. The calculations above do not claim to settle that stronger question. They do settle the incorrect inference from grazing alone, provide exact geometric counterexamples to the differentiability and coefficient-one curvature claims, and give sufficient mathematical replacements for certification.
