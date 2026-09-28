# Marketing tools

Double-click **Tau-Marketing.bat** (Windows). The first run sets up a private Python environment in this folder, which takes a few minutes and needs Python from python.org (tick "Add python.exe to PATH" when installing).

## Making a stick-figure clip

1. **Rotoscope a clip** (menu option 1, or drag a video onto the .bat). The video is copied into `clips\`, both fighters are detected, and the editor opens.
2. In the editor, open the video and its `.pose.json` from `clips\`. Fix mistakes:
   - Drag a joint to fix it. Nearby frames ease into the fix. Fix both ends of a bad stretch and the frames between follow.
   - **S** swaps red and blue from the current frame on, for when the detector mixes them up.
   - Orange timeline marks are suspicious jumps. **N** / **P** jump between them.
   - **V** previews the stylised look. **Save edits** keeps your work to continue later.
3. Click **Export corrected**, save it into `clips\`, then drag it onto the .bat (or use option 3). Choose widescreen or phone 9:16. You get `clips\<name>_tau.mp4`.

Everything in `clips\` stays on your computer and isn't committed to git.

## Tips

- Clips where the fighters are mostly apart work best. Tight clinches confuse the detector.
- Check the feet first: they're the least reliable joints.
- For ads, only use footage you have the rights to (your own filming, or Creative Commons with the licence checked).
