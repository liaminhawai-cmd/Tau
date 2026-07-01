
public class FootCrossTracker
{
    public int crossingsThisTurn = 0;
    public bool startedOnLine = false;
    public void ResetForNewTurn(){ crossingsThisTurn = 0; startedOnLine = false; }
}
