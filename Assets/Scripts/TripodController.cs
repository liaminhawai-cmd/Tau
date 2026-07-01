
using UnityEngine;
using System.Collections.Generic;

[RequireComponent(typeof(Rigidbody))]
public class TripodController : MonoBehaviour
{
    public int playerId = 0;
    public Transform foot1, foot2, foot3;
    public BoardLines board;
    public GameConfig config;
    public TurnManager turnManager;

    Rigidbody rb;
    bool isActive;
    Transform pinnedFoot;
    Vector3 pivot;
    int angularSign = 0;
    Dictionary<Transform, FootCrossTracker> footTrackers = new Dictionary<Transform, FootCrossTracker>();

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
        if (!board) board = FindObjectOfType<BoardLines>();
        if (!config) config = FindObjectOfType<GameConfig>();
        if (!turnManager) turnManager = FindObjectOfType<TurnManager>();
        footTrackers[foot1] = new FootCrossTracker();
        footTrackers[foot2] = new FootCrossTracker();
        footTrackers[foot3] = new FootCrossTracker();
    }

    public void SetActivePlayer(bool active)
    {
        isActive = active;
        rb.isKinematic = active; // drive active piece
        if (active) BeginTurn();
        else EndTurnInternal();
    }

    void BeginTurn()
    {
        pinnedFoot = null; angularSign = 0;
        foreach (var ft in footTrackers.Values) ft.ResetForNewTurn();
    }

    void EndTurnInternal(){ pinnedFoot = null; angularSign = 0; }

    public void PlaceAtStart(Vector2[] startTriangleMm)
    {
        float s = GameConfig.UnitsToMeters;
        Quaternion rot = (playerId == 0) ? Quaternion.identity : Quaternion.Euler(0,180,0);
        Vector3[] targets = new Vector3[3];
        for (int i=0;i<3;i++)
        {
            Vector2 v = startTriangleMm[i] * s;
            targets[i] = rot * new Vector3(v.x, 0f, v.y);
        }
        Vector3 cen = (targets[0]+targets[1]+targets[2])/3f;
        Vector3 delta = cen - transform.position;
        transform.position += delta;
    }

    void Update()
    {
        if (!isActive) return;
        HandleInput();
    }

    void HandleInput()
    {
        if (Input.GetMouseButtonDown(0))
        {
            Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out RaycastHit hit, 100f))
            {
                if (hit.transform == foot1 || hit.transform == foot2 || hit.transform == foot3)
                { pinnedFoot = hit.transform; pivot = pinnedFoot.position; angularSign = 0; }
            }
        }
        if (Input.GetMouseButton(0) && pinnedFoot != null)
        {
            float dx = Input.GetAxis("Mouse X");
            float desired = dx * config.maxAngularSpeedDegPerSec;
            if (desired != 0)
            {
                int sgn = desired > 0 ? 1 : -1;
                if (angularSign == 0) angularSign = sgn;
                if (sgn != angularSign) return; // no reversing this turn
            }
            float angDeg = angularSign * config.maxAngularSpeedDegPerSec * Time.deltaTime;
            RotateAroundPivot(angDeg);
        }
        if (Input.GetMouseButtonUp(0) && pinnedFoot != null)
        { pinnedFoot = null; angularSign = 0; turnManager?.EndTurn(); }
    }

    void RotateAroundPivot(float angDeg)
    {
        transform.RotateAround(pivot, Vector3.up, angDeg);
        // TODO: integrate ring-cross clamping and start-on-line grace.
    }

    public IEnumerable<Vector3> FootWorldPositions()
    {
        yield return foot1.position; yield return foot2.position; yield return foot3.position;
    }
}
