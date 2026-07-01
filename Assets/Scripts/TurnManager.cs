
using UnityEngine;

public class TurnManager : MonoBehaviour
{
    public TripodController red;
    public TripodController blue;
    public int activePlayer = 0;

    void Start()
    {
        if (red) red.SetActivePlayer(activePlayer == 0);
        if (blue) blue.SetActivePlayer(activePlayer == 1);
    }

    public void EndTurn()
    {
        activePlayer = 1 - activePlayer;
        if (red) red.SetActivePlayer(activePlayer == 0);
        if (blue) blue.SetActivePlayer(activePlayer == 1);
    }
}
