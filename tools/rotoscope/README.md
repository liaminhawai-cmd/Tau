# Tau Rotoscope

Turns fight footage into clean red and blue stick figures in Tau's colours, with an editor for fixing the detector's mistakes.

## Setup (once)

1. Install Python 3.10 or newer from python.org.
2. In this folder, run:

   ```
   pip install -r requirements.txt
   ```

## Use

1. **Detect** the fighters in a clip (the first run downloads a ~9 MB model):

   ```
   python detect.py fight.mp4
   ```

   This writes `fight.pose.json`. For a single person, add `--people 1`.

2. **Edit.** Open `editor.html` in Chrome or Edge, then open (or drag in) both `fight.mp4` and `fight.pose.json`.
   - Drag a joint to fix it. Nearby frames ease into the fix. Fix both ends of a bad stretch and the frames between follow.
   - Red and blue mixed up? Go to the frame where it happens and press **S** to swap them from there on.
   - Orange marks on the timeline are suspicious jumps. Press **N** / **P** to jump between them.
   - Press **V** to preview the stylised look. Edits autosave in the browser, and **Save edits** writes them into the JSON so you can pick up later.

3. **Render.** Click **Export corrected** in the editor, then:

   ```
   python render.py fight.corrected.json
   ```

   This gives you `fight_tau.mp4`. Use `--width 1080 --height 1920` for phone framing and `--smooth 2` for steadier lines. The editor's **Record video** button is a quicker alternative that saves a .webm.

## Tips

- Pick clips where the fighters are mostly separate. Tight clinches confuse the detector the most.
- Feet are the least reliable joints, so check them first.
- Everything runs on your computer. Clips never leave it.
- Only use footage you have the rights to for ads (your own filming, or Creative Commons with the licence checked).
