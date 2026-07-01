# Tau — Unity Project Starter (All-in-one)

Includes:
- Models: base 400 v2.stl
- Scripts: TripodController, GameConfig, BoardLines, TurnManager, WinChecker, FootGizmo, FootCrossTracker
- Setup guide in this README

Unity: 2022.3 LTS recommended

Quick steps:
1) Unzip into your project folder; open in Unity.
2) Import STLs with Scale Factor 0.001 (mm -> m).
3) Add MeshCollider to board; add BoardLines (BoardRadiusMm ~ 230.418; set ring radii).
4) Tripods: Rigidbody (Use Gravity OFF), 3 child foot transforms with small colliders; add TripodController.
5) GameManager: TurnManager + WinChecker; assign references.
6) Add GameConfig; right-click component -> Apply Start Positions.
7) Press Play. Click a foot to pin; drag to rotate in one direction. Win on any foot off edge.
