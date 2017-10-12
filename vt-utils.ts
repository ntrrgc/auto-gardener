export function vtPadLeft(str: string, desiredWidth: number) {
    const widthWithoutVtCodes = str.replace(/\x1b.*?m/g, "").length;

    for (let i = widthWithoutVtCodes; i < desiredWidth; i++) {
        str += " ";
    }
    return str;
}

export interface VtLine {
    // Unfortunately, for a line to be covered entirely by a background color, it must be set before the end of the
    // previous line, so we have to plan them in advance.
    text: string;
    bgColorCode: string;
}

export function printVtLines(lines: VtLine[], consoleWidth: number) {
    const colorReset = "\x1b[0m"

    // Print lines, printing the background color code of the following one before the newline.
    if (lines.length > 0) {
        let i = 0;
        console.log(lines[i].bgColorCode);
        for (; i < lines.length; i++) {
            const nextLineColorCode = lines[i + 1]
                ? lines[i + 1].bgColorCode
                : colorReset;

            // Redundant color codes are added at the beginning of the line to be friendly with `less -R`.
            // Also, padding the lines to the console width avoids less resetting the color for the remaining
            // line characters.
            const paddedText = vtPadLeft(lines[i].text, consoleWidth);
            console.log(lines[i].bgColorCode + paddedText + nextLineColorCode);
        }
    }
}