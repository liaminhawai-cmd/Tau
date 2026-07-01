
using UnityEngine;

[DefaultExecutionOrder(-100)]
public class GameConfig : MonoBehaviour
{
    public static float UnitsToMeters = 0.001f; // mm → m

    [Header("Board")]
    public float boardRadiusMm = 230.418f;
    public float[] ringRadiiMm = new float[] { 40f, 53.3f, 66.6667f, 73.3333f };

    [Header("Start Triangle (mm, centered at origin)")]
    public Vector2[] startTriangleMm = new Vector2[] {
        new Vector2(-40.00f, -23.09f),
        new Vector2(  0.00f,  46.19f),
        new Vector2( 40.00f, -23.09f)
    };

    [Header("Turn Rules")]
    public float maxAngularSpeedDegPerSec = 90f;
    public float edgeEpsilonMm = 0.5f;

    [ContextMenu("Apply Start Positions")]
    public void ApplyStartPositions()
    {
        var pieces = GameObject.FindObjectsOfType<TripodController>();
        foreach (var p in pieces) p.PlaceAtStart(startTriangleMm);
    }

    public float BoardRadiusMeters => boardRadiusMm * UnitsToMeters;
    public float EdgeEpsilonMeters => edgeEpsilonMm * UnitsToMeters;

    public int RegionIndexForRadius(float rMeters)
    {
        float rMm = rMeters / UnitsToMeters;
        int idx = 0;
        for (int i = 0; i < ringRadiiMm.Length; i++)
            if (rMm >= ringRadiiMm[i]) idx++;
        return idx;
    }
}
