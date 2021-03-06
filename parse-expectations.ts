import * as fs from "fs";
import {Path, TestExpectation, TestOutcome} from "./main";
import {ensure} from "./functional-utils";
import {BuildType} from "./contexts";

const dontShowUnexpectedPasses = false;

function consumeWordToken(line: string): [string, string | null] {
    line = line.trim();
    if (!line) {
        return [line, null];
    }

    const match = /(.*?)\s*(\S+)$/.exec(line);
    if (!match) {
        throw new Error(`Could not find word: "${line}"`);
    }

    return [match[1], match[2]];
}

function consumeBracketedEntityToken(line: string): [string, string | null] {
    line = line.trim();
    if (!line) {
        return [line, null];
    }

    const match = /(.*?)\s*\[\s*([^\]]+?)\s*]$/.exec(line);
    if (!match) {
        return [line, null]
    }

    return [match[1], match[2]];
}

function consumeBracketedEntityTokenUnitTests() {
    function check(a: [string, string | null], b: [string, string | null]) {
        if (a[0] != b[0]) {
            console.warn(`Expected line "${a[0]}" == "${b[0]}"`);
        }
        if (a[1] != b[1]) {
            console.warn(`Expected token "${a[1]}" == "${b[1]}"`);
        }
    }

    check(consumeWordToken("aa bb"), ["aa", "bb"]);
    check(consumeWordToken("aa b/xxx/c "), ["aa", "b/xxx/c"]);
    check(consumeWordToken("zz"), ["", "zz"]);
    check(consumeWordToken(""), ["", null]);
    check(consumeBracketedEntityToken("bb [ Pass Fail ]"), ["bb", "Pass Fail"]);
    check(consumeBracketedEntityToken("bb [ Pass] "), ["bb", "Pass"]);
    check(consumeBracketedEntityToken("cc dd"), ["cc dd", null]);
    check(consumeBracketedEntityToken("cc dd "), ["cc dd", null]);
}

export function parseExpectations(filePath: string): TestExpectation[] {
    const fileText: string = fs.readFileSync(filePath, "UTF-8");
    if (fileText == null) {
        throw new Error("Could not read expectations file");
    }
    const lines = fileText.split("\n");

    const collectedExpectations = new Array<TestExpectation>()
    let lineNo = 0;

    for (let line of lines) {
        lineNo++;

        // Remove comments
        line = line.split("#", 1)[0];
        // Clean whitespace
        line = line.trim();

        if (line == "")
            continue;

        let outcomes: Set<TestOutcome>;
        let outcomesString: string | null;
        [line, outcomesString] = consumeBracketedEntityToken(line);
        if (outcomesString) {
            outcomes = new Set<TestOutcome>(outcomesString
                .split(" ")
                .map(x => x.trim())
                .filter(x => x != "")
                .map(str => ensure(TestOutcome[str as keyof typeof TestOutcome],
                    `Unknown outcome at line ${lineNo}: "${str}"`))
                .filter(x => x != TestOutcome.DumpJSConsoleLogInStdErr));

            if (outcomes.size == 0) {
                outcomes = new Set([TestOutcome.Pass]);
            }
            if (dontShowUnexpectedPasses) {
                outcomes.add(TestOutcome.Pass);
            }
        } else {
            // console.warn(`Could not parse expected outcomes at line ${lineNo}: "${line}"`);
            // Consider as Skip
            outcomes = new Set([TestOutcome.Skip]);
        }

        let testPathString: string | null;
        [line, testPathString] = consumeWordToken(line);
        if (!testPathString) {
            console.warn(`Could not parse test path at line ${lineNo}: "${line}"`);
            continue;
        }
        const testPath = new Path(testPathString.split("/"));

        let buildTypeConstraintString: string | null;
        [line, buildTypeConstraintString] = consumeBracketedEntityToken(line);
        let buildTypeConstraint: BuildType | null;
        if (buildTypeConstraintString) {
            buildTypeConstraint = ensure(BuildType[buildTypeConstraintString as keyof typeof BuildType],
                `Unknown build type at line ${lineNo}: "${buildTypeConstraintString}"`);
        } else {
            // No build type constraint
            buildTypeConstraint = null;
        }

        let bugIds = new Array<number>();
        while (line != "") {
            let bugString: string | null;
            [line, bugString] = consumeWordToken(line);
            if (bugString) {
                const match = /^webkit.org\/b\/(\d+)\s*$/.exec(bugString);
                if (match) {
                    const bugId = parseInt(match[1]);
                    if (Number.isNaN(bugId)) {
                        throw new Error(`Invalid bug number: "${match[1]}"`);
                    }
                    bugIds.push(bugId);
                }
            }
        }

        if (line != "") {
            throw new Error(`Unparsed line contents remain at line ${lineNo}: "${line}"`);
        }

        const newExpectation = new TestExpectation(lineNo, testPath, bugIds, outcomes, buildTypeConstraint)
        collectedExpectations.push(newExpectation);
    }

    return collectedExpectations;
}