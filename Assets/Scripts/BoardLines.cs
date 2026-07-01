
using UnityEngine;

public class BoardLines : MonoBehaviour
{
    public GameConfig config;
    void Awake(){ if (!config) config = FindObjectOfType<GameConfig>(); }

    public bool IsFootOffBoard(Vector3 worldPos)
    {
        Vector2 p = new Vector2(worldPos.x, worldPos.z);
        return p.magnitude > (config.BoardRadiusMeters + config.EdgeEpsilonMeters);
    }
    public int RegionIndex(Vector3 worldPos)
    {
        Vector2 p = new Vector2(worldPos.x, worldPos.z);
        return config.RegionIndexForRadius(p.magnitude);
    }
    public int CountRingCrossings(Vector3 from, Vector3 to)
    {
        int a = RegionIndex(from);
        int b = RegionIndex(to);
        return Mathf.Abs(b - a);
    }
}
