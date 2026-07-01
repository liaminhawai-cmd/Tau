
using UnityEngine;

[ExecuteAlways]
public class FootGizmo : MonoBehaviour
{
    public Color color = Color.cyan;
    void OnDrawGizmos()
    {
        Gizmos.color = color;
        Gizmos.DrawSphere(transform.position, 0.004f); // 4mm editor sphere
    }
}
