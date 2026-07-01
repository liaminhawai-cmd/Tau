
using UnityEngine;

public class WinChecker : MonoBehaviour
{
    public BoardLines board;
    public TripodController red;
    public TripodController blue;

    void Awake(){ if (!board) board = FindObjectOfType<BoardLines>(); }

    void Update()
    {
        if (!red || !blue) return;
        if (AnyFootOff(red)) { Debug.Log("Blue wins (red foot off)!"); enabled = false; }
        else if (AnyFootOff(blue)) { Debug.Log("Red wins (blue foot off)!"); enabled = false; }
    }

    bool AnyFootOff(TripodController t)
    {
        foreach (var f in t.FootWorldPositions())
            if (board.IsFootOffBoard(f)) return true;
        return false;
    }
}
