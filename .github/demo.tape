# VHS tape for the README demo GIF — a guided, live FIX decode with @boarteam/fix.
# Regenerate with:  vhs .github/demo.tape   (see scripts/render-demo.sh)
# Install VHS: https://github.com/charmbracelet/vhs  (brew install vhs)
#
# A real FIX log line is piped into examples/demo-decode.mjs, which (in --present mode)
# reveals the decode in narrated stages with its own pauses — VHS records those in real time.
# Everything shown is real engine output; nothing is faked. `Wait` holds until the verdict
# line ("never threw") appears, so the tape stays correct regardless of the script's timing.

Output .github/demo.gif
Output .github/demo.mp4

Require node

Set Shell "bash"
Set FontSize 16
Set Width 1040
Set Height 660
Set Padding 24
Set Margin 0
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms
Set WaitTimeout 30s

# Hero — pipe a clean Market Data Snapshot in; watch it decode field-by-field into structure.
Hide
Type "clear" Enter
Show
Sleep 400ms
Type "cat examples/samples/trade.fix | node examples/demo-decode.mjs --present" Enter
Wait+Screen /never threw/
Sleep 6s

# Coda — now feed it a corrupted message; it parses anyway, every defect returned as data.
Hide
Type "clear" Enter
Show
Sleep 400ms
Type "cat examples/samples/corrupt.fix | node examples/demo-decode.mjs --present --brief" Enter
Wait+Screen /never threw/
Sleep 7500ms
