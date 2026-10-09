# FAQ & troubleshooting

## Installation

??? question "macOS: "PlateMap Studio is damaged and can't be opened""
    The app isn't damaged. macOS blocks apps downloaded from the internet that aren't notarized by Apple. Click **Done** (not *Move to Trash*), then run in Terminal:

    ```bash
    xattr -cr "/Applications/PlateMap Studio.app"
    ```

    and open the app again. On version 0.1.0 also run:

    ```bash
    codesign --force --deep --sign - "/Applications/PlateMap Studio.app"
    ```

    Version 0.1.1 and later are signed, so this second step isn't needed.

??? question "macOS: "cannot be opened because the developer cannot be verified""
    Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. You only need to do this once.

??? question "Windows: "Windows protected your PC""
    Click **More info → Run anyway**. The app isn't code-signed with a paid certificate, so SmartScreen doesn't recognise it yet.

??? question "Linux: the AppImage does nothing / sandbox error on Ubuntu 24.04"
    Ubuntu 24.04 restricts AppImage sandboxes. Install the `.deb` instead, or start the AppImage with `--no-sandbox`. If it complains about FUSE, run `sudo apt install libfuse2`.

??? question "Which Mac file: arm64 or x64?"
    Apple menu → **About This Mac**. *Apple M1–M4* → `arm64`. *Intel* → `x64`.

## Using the app

??? question "I made a mistake three steps ago"
    Open the **History** tab and click the step just before the mistake. Or press ++ctrl+z++ a few times.

??? question "The app closed and I didn't save"
    Start it again and choose **Continue last session**. Work is autosaved after every edit.

??? question "How do I use nM / ng/ml instead of µM?"
    Use the unit dropdown next to the concentration in the Inspector, or type the unit (`10 nM`). To change the default for new values, open the field settings (⚙ next to *Concentration*). See [Units](../user-guide/units.md).

??? question "A compound has the same color as a cell line"
    Click the swatch next to the value and pick another color, or use **Apply palette…** on the field. New values automatically avoid colors already used by other fields.

??? question "Vehicle doesn't fill in for a new compound"
    Auto-fill only knows a compound after you've set its vehicle once (or imported a platemap that had it). Set it on one well, or fill in the mapping table in the field settings. The **Checks** tab lists compounds without a vehicle.

??? question "My platemap columns need different names"
    Edit the header text in the platemap export dialog, or click **Use header from CSV…** to copy them from an existing file. See [Platemap export](../advanced/platemap-export.md#columns).

??? question "Exported PNG looks blurry in Word"
    Export at 600 dpi, or use PDF/SVG. The DPI is stored in the PNG, so Word sizes it correctly.

??? question "Can several people work on one project?"
    Share the `.platemap` file (by email, a shared drive, or Git). It's plain JSON. Simultaneous editing isn't supported.

## Still stuck?

Open an issue at [github.com/LIVR-VUB/Platemap-studio/issues](https://github.com/LIVR-VUB/Platemap-studio/issues) with a screenshot and your app version (shown in the release file name).
