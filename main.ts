import * as fs from "fs";

const dontShowUnexpectedPasses = false;

enum TestOutcome {
    NoData,
    Pass,
    Failure,
    Skip,
    WontFix,
    Timeout,
    ImageOnlyFailure,
    Slow,
    Crash,
    Missing,
    DumpJSConsoleLogInStdErr,
}

function testOutcomeToLetter(outcome: TestOutcome): string {
    switch (outcome) {
        case TestOutcome.NoData:
            return "N";
        case TestOutcome.Pass:
            return "P";
        case TestOutcome.Failure:
            return "F";
        case TestOutcome.Crash:
            return "C";
        case TestOutcome.Timeout:
            return "T";
        case TestOutcome.ImageOnlyFailure:
            return "I";
        case TestOutcome.Slow:
            return "S";
        case TestOutcome.Missing:
            return "M";
        default:
            throw new Error(`Unexpected outcome: ${TestOutcome[outcome]} (${outcome})`);
    }
}

function testOutcomeToColor(outcome: TestOutcome, colorType: "bg" | "fg"): string {
    const prefix = colorType == "bg" ? "\x1b[48;5;" : "\x1b[38;5;";
    switch (outcome) {
        case TestOutcome.NoData:
        case TestOutcome.Missing:
            return `${prefix}251m`;
        case TestOutcome.Pass:
            return `${prefix}34m`;
        case TestOutcome.Failure:
            return `${prefix}9m`;
        case TestOutcome.Crash:
            return `${prefix}130m`;
        case TestOutcome.Timeout:
            return `${prefix}3m`;
        case TestOutcome.ImageOnlyFailure:
            return `${prefix}27m`;
        case TestOutcome.Slow:
            return `${prefix}0m`;
        default:
            throw new Error(`Unexpected outcome: ${TestOutcome[outcome]} (${outcome})`);
    }
}

enum BuildType {
    Debug,
    Release
}

enum ToStringMode {
    Normal = 0,
    WithColors = 1,
    PadBugLink = 2,
}

class TestExpectation {
    constructor(
        public lineNo: number,
        public testPath: Path,
        public bugIds: number[],
        public expectedOutcomes: Set<TestOutcome>,
        public buildTypeConstraint: BuildType | null = null)
    {}

    matchesTest(path: Path,buildType: BuildType): boolean {
        return this.testPath.equalsOrContains(path) &&
            (this.buildTypeConstraint == null || this.buildTypeConstraint == buildType);
    }

    expectedOutcomesInclude(outcome: TestOutcome): boolean {
        return this.expectedOutcomes.has(outcome) ||
            this.expectedOutcomes.has(TestOutcome.Skip);
    }

    toString(flags: ToStringMode, currentBgColor: string): string {
        const bugLinkWidth = 19;
        const parts = new Array<string>();

        for (let bugId of this.bugIds) {
            let url = `webkit.org/b/${bugId}`;
            if (flags & ToStringMode.PadBugLink) {
                url = vtPadLeft(url, bugLinkWidth);
            }
            parts.push(flags & ToStringMode.WithColors
                ? `\x1b[38;5;219;4m${url}\x1b[38;5;255;24m`
                : url);
        }
        if (flags & ToStringMode.PadBugLink && this.bugIds.length == 0) {
            // Add empty padding with the size of a bug URL.
            parts.push(vtPadLeft("", bugLinkWidth));
        }

        if (this.buildTypeConstraint != null) {
            parts.push(`[ ${BuildType[this.buildTypeConstraint]} ]`);
        }
        parts.push(this.testPath.toString())

        const outcomes = `[ ${Array.from(this.expectedOutcomes.values())
            .map(outcome => flags & ToStringMode.WithColors
                ? (testOutcomeToColor(outcome, "bg") + TestOutcome[outcome] + currentBgColor)
                : TestOutcome[outcome])
            .join(" ")
            } ]`;
        parts.push(flags & ToStringMode.WithColors
            ? `\x1b[38;5;253m${outcomes}\x1b[38;5;255m`
            : outcomes);

        return parts.join(" ");
    }
}

class Path {
    constructor(public entries: string[]) {
    }

    equals(other: Path) {
        if (this.entries.length != other.entries.length) {
            return false;
        } else {
            return this.equalsOrContains(other);
        }
    }

    equalsOrContains(other: Path) {
        for (let i = 0; i < this.entries.length; i++) {
            if (this.entries[i] != other.entries[i]) {
                return false;
            }
        }
        return true;
    }

    baseName() {
        return this.entries[this.entries.length - 1];
    }

    dirName() {
        return this.entries.slice(0, this.entries.length - 1).join("/");
    }

    toString() {
        return this.entries.join("/");
    }
}

function ensure<T>(thing: T, errorIfNull: string = "Unexpected null") {
    if (thing == null) {
        throw Error(errorIfNull);
    } else {
        return thing;
    }
}

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

function test() {
    function check(a: [string, string|null], b: [string, string|null]) {
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

function parseExpectations(filePath: string): TestExpectation[] {
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


interface ReleaseJson {
    [platformName: string]: JSONReleasePlatform;
}
interface JSONReleasePlatform {
    tests: JSONTestDirectory;
    buildNumbers: string[];
    webkitRevision: string[];
}
interface JSONTestDirectory {
    [nodeName: string]: JSONTestDirectory | JSONTest;
}
interface JSONTest {
    results: JSONTestOutcomeHistoryEntry[],
    times: JSONTestTimesHistoryEntry[];
}
type JSONTestOutcomeLetter = string;
type JSONTestOutcomeHistoryEntry = [
    number, // number of occurrences
    JSONTestOutcomeLetter // outcome
];
interface JSONTestTimesHistoryEntry {
    0: number; // number of occurrences
    1: number; // time in seconds
}

interface TestContext {
    platform: "gtk";
    buildType: BuildType;
}

interface TestResult {
    webkitRevision: number;
    outcome: TestOutcome;
}

interface BotsTestResults {
    context: TestContext;
    webkitRevisions: number[]; //most recent first
    testHistories: TestHistory[];
}

type RevisionRange = number | {start: number, end: number} | "long ago" | "never failed";

class TestHistory {
    constructor(public context: TestContext,
                public testPath: Path,
                public lastResults: TestResult[], // most recent first
                public expectation: TestExpectation | null)
    {}

    getTestResult(webkitRevision: number): TestResult | null {
        return this.lastResults.find(x => x.webkitRevision == webkitRevision) || null;
    }

    /**
     * true: test matches expectation
     * false: test does not match expectation
     * null: there is no data for that test in that revision
     */
    matchesExpectation(webkitRevision: number): boolean | null {
        const testResult = this.getTestResult(webkitRevision);
        if (!testResult || testResult.outcome == TestOutcome.NoData) {
            // This test has not been run in the specified revision
            return null;
        }

        if (!this.expectation) {
            // This test does not appear in TestExpectations, it should pass
            return testResult.outcome == TestOutcome.Pass;
        } else {
            // The test should match the expectation
            return this.expectation.expectedOutcomesInclude(testResult.outcome);
        }
    }

    getExpectationWithDefault() {
       if (this.expectation) {
           return this.expectation;
       } else {
           return new TestExpectation(-1, this.testPath, [], new Set([TestOutcome.Pass]), null);
       }
    }

    historyString() {
        return this.lastResults
            .map(result => testOutcomeToColor(result.outcome, "bg") + testOutcomeToLetter(result.outcome))
            .join("") + "\x1b[0m";
    }

    findFirstFailedRevisionRange(): RevisionRange {
        let wasWorkingOnRevision: number | null = null;
        for (let i = this.lastResults.length - 1; i >= 0; i--) {
            const result = this.lastResults[i];
            const resultMatchesExpectation = this.matchesExpectation(result.webkitRevision);
            if (resultMatchesExpectation == false) {
                if (wasWorkingOnRevision == null) {
                    // First data we have on the test is already a failure
                    if (this.lastResults.length >= 100) {
                        return "long ago";
                    } else {
                        // The test is quite recent, it's useful to know its revision
                        return result.webkitRevision;
                    }
                } else if (result.webkitRevision - wasWorkingOnRevision == 1) {
                    // Failed on this exact revision
                    return result.webkitRevision;
                } else {
                    // Failed somewhere between these revisions (both ends included)
                    return {start: wasWorkingOnRevision + 1, end: result.webkitRevision};
                }
            } else if (resultMatchesExpectation == true) {
                wasWorkingOnRevision = result.webkitRevision;
            }
        }
        return "never failed";
    }

    static formatRevisionRangeString(revisionRange: RevisionRange): string {
        if (typeof revisionRange == "string") {
            return revisionRange;
        } else if (typeof revisionRange == "number") {
            return revisionRange.toString();
        } else {
            return `${revisionRange.start}-${revisionRange.end}`;
        }
    }

    constructFirstFailedRevisionMessage(): string | null {
        const firstFailedRange = this.findFirstFailedRevisionRange();
        if (typeof firstFailedRange == "string") {
            // Nothing interesting
            return null;
        }
        const firstKnownFailedRevision: number = typeof firstFailedRange == "number"
            ? firstFailedRange
            : firstFailedRange.end;

        const firstPassAfterwards = this.findFirstPassingRevisionAfter(firstKnownFailedRevision);
        if (!firstPassAfterwards) {
            // Consistently failing
            return `Failing since ${TestHistory.formatRevisionRangeString(firstFailedRange)}`;
        } else {
            // Flaky, but since when?
            const firstFailIsOld = this.isRevisionOld(firstKnownFailedRevision);
            const firstPassAfterwardsIsOld = this.isRevisionOld(firstPassAfterwards);
            if (firstFailIsOld && firstPassAfterwardsIsOld) {
                return `Flaky since long ago`;
            } else {
                return `Flaky since ${TestHistory.formatRevisionRangeString(firstFailedRange)}`;
            }
        }
    }

    /**
     * A revision is considered old if its slot in the test history has a great enough index.
     * @param {number} revision
     */
    private isRevisionOld(revision: number) {
        const index = this.lastResults.findIndex(result => result.webkitRevision == revision);
        if (index == -1) {
            throw new Error(`Could not find revision ${revision}`);
        }
        return index > 40;
    }

    private findFirstPassingRevisionAfter(firstKnownFailedRevision: number): number | null {
        for (let i = this.lastResults.length - 1; i >= 0; i--) {
            const result = this.lastResults[i];
            const resultMatchesExpectation = this.matchesExpectation(result.webkitRevision);

            if (result.webkitRevision > firstKnownFailedRevision && resultMatchesExpectation == true) {
                return result.webkitRevision;
            }
        }
        return null;
    }
}

function getReleaseJsonPlatformName(releaseJson: ReleaseJson) {
    for (let key in releaseJson) {
        if (key != "version") {
            return key;
        }
    }
    throw new Error("Could not find platform name in release.json.");
}

function parseOutcomeString(outcomeString: JSONTestOutcomeLetter): TestOutcome {
    const outcomeDict: {[key: string]: TestOutcome} = {
        "N": TestOutcome.NoData, // no data,
        "P": TestOutcome.Pass,
        "F": TestOutcome.Failure,
        "C": TestOutcome.Crash,
        "T": TestOutcome.Timeout,
        "I": TestOutcome.ImageOnlyFailure,
        "A": TestOutcome.Failure, // AudioOnlyFailure?
        "O": TestOutcome.Missing,
    };
    if (!(outcomeString in outcomeDict)) {
        throw new Error(`Unknown test outcome string: "${outcomeString}"`);
    }
    return outcomeDict[outcomeString];
}

function maxBy<T, W>(array: T[], predicate: (item: T) => W): T | null {
    let currentMaxWeight: W | undefined = undefined;
    let currentMax: T | null = null;
    let firstItem = true;
    for (let item of array) {
        const weight = predicate(item);
        if (firstItem || weight > currentMaxWeight!) {
            currentMax = item;
            currentMaxWeight = weight;
            firstItem = false;
        }
    }
    return currentMax;
}

function findMostSpecificExpectation(allExpectations: TestExpectation[],
                                     testPath: Path,
                                     buildType: BuildType): TestExpectation | null
{
    const matches = allExpectations.filter(expectation => expectation.matchesTest(testPath, buildType));
    return maxBy(matches, expectation => expectation.testPath.entries.length);
}

function parseReleaseJson(context: TestContext, releaseJson: ReleaseJson): BotsTestResults {
    const jsonReleasePlatform = releaseJson[getReleaseJsonPlatformName(releaseJson)];
    const collectedTestHistories = new Array<TestHistory>();
    const webkitRevisions = jsonReleasePlatform.webkitRevision.map(x => parseInt(x));
    if (webkitRevisions[0] <= webkitRevisions[1]) throw new Error("assertion error");

    function collectTestHistory(testPathNodes: string[], jsonTest: JSONTest) {
        const testPath = new Path(testPathNodes);
        const expectation = findMostSpecificExpectation(allExpectations, testPath, context.buildType);

        const lastResults = new Array<TestResult>();
        let webkitRevisionIndex = 0;
        for (let [occurrences, outcomeString] of jsonTest.results) {
            const outcome = parseOutcomeString(outcomeString);
            for (let i = 0; i < occurrences; i++) {
                if (webkitRevisionIndex < webkitRevisions.length) {
                    const testResult: TestResult = {
                        webkitRevision: ensure(webkitRevisions[webkitRevisionIndex],
                            `Could not find revision #${webkitRevisionIndex}`),
                        outcome: outcome,
                    };
                    lastResults.push(testResult);
                }
                webkitRevisionIndex++;
            }
        }

        const newTestHistory = new TestHistory(context, testPath, lastResults, expectation);
        collectedTestHistories.push(newTestHistory);
    }

    function traverseTestTree(root: string[], folder: JSONTestDirectory) {
        for (let entryName in folder) {
            if (entryName.indexOf(".") != -1 && "results" in folder[entryName] && "times" in folder[entryName]) {
                // it's a test
                const jsonTest = <JSONTest>folder[entryName];
                collectTestHistory(root.concat(entryName), jsonTest);
            } else {
                // it's a folder
                traverseTestTree(root.concat(entryName), <JSONTestDirectory>folder[entryName]);
            }
        }
    }

    traverseTestTree([], jsonReleasePlatform.tests);
    return {
        webkitRevisions: webkitRevisions,
        context: context,
        testHistories: collectedTestHistories,
    };
}

function groupBy<K, T>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
    const ret = new Map<K, T[]>();
    for (let item of items) {
        const key = keyFn(item);

        if (!ret.has(key)) {
            ret.set(key, []);
        }

        ret.get(key)!.push(item);
    }
    return ret;
}

function compareArrays<T>(a: T[], b: T[]): number {
    for (let i = 0; i < a.length; i++) {
        if (i > b.length) {
            return 1;
        }

        if (a[i] > b[i]) {
            return 1;
        } else if (a[i] < b[i]) {
            return -1;
        }
    }
    return 0;
}

function poorManCompareArrayUnitTests() {
    function comp(a: any[], b: any[], expected: number) {
        const actual = compareArrays(a, b);
        if (actual != expected) {
            console.warn(`${a} - ${b} ~ ${actual} (expected ${expected})`);
        }
    }

    comp([], [], 0);
    comp([1], [2], -1);
    comp([2], [1], 1);
    comp([1], [1], 0);
    comp(["a"], ["b"], -1);
    comp(["b"], ["a"], 1);
    comp(["a"], ["a"], 0);
    comp(["a", 1], ["a", null], 1);
    comp(["a", 1], ["a", 1], 0);
    comp(["a", 1], ["a", 2], -1);
}

function sortedBy<T, K>(items: Iterable<T>, keyFn: (item: T) => K[]): T[] {
    const ret = Array.from(items);
    ret.sort((a, b) => {
        const ka = keyFn(a);
        const kb = keyFn(b);
        return compareArrays(ka, kb);
    });
    return ret;
}

function vtPadLeft(str: string, desiredWidth: number) {
    const widthWithoutVtCodes = str.replace(/\x1b.*?m/g, "").length;

    for (let i = widthWithoutVtCodes; i < desiredWidth; i++) {
        str += " ";
    }
    return str;
}

interface VtLine {
    // Unfortunately, for a line to be covered entirely by a background color, it must be set before the end of the
    // previous line, so we have to plan them in advance.
    text: string;
    bgColorCode: string;
}

function formatContext(context: TestContext) {
    return `${context.platform.toUpperCase()} ${BuildType[context.buildType]}`;
}

function findTestsWithInvalidExpectations(botTestsResults: BotsTestResults): TestHistory[] {
    const latestRevision = botTestsResults.webkitRevisions[0];

    const colorReset = "\x1b[0m";
    const testNameColumnWidth = 131;
    const entireOutputWidth = 231;

    const testHistoriesWithInvalidExpectations = botTestsResults.testHistories
        .filter(history => history.matchesExpectation(latestRevision) === false);

    const testHistoryByOutcome = groupBy(testHistoriesWithInvalidExpectations,
            history => history.getTestResult(latestRevision)!.outcome);

    const lines = new Array<VtLine>();

    console.log(`\x1b[1;4mGardening report for ${latestRevision} (${formatContext(botTestsResults.context)})\x1b[21;24m`);

    for (let [outcome, outcomeHistories] of sortedBy(testHistoryByOutcome.entries(), ([outcome, _]) => [outcome])) {
        if (outcome == TestOutcome.NoData) {
            // No point to report tests we no longer have any data about.
            continue;
        }

        const colorEven = "\x1b[48;5;8;38;5;256m";
        const colorOdd = "\x1b[48;5;243;38;5;256m";

        lines.push({text: `\x1b[1mUnexpected ${TestOutcome[outcome]}:\x1b[0m`, bgColorCode: colorReset});

        outcomeHistories = sortedBy(outcomeHistories, (testHistory: TestHistory) => [
            testHistory.testPath.dirName(),
            -(testHistory.getExpectationWithDefault().bugIds[0] || -Infinity),
            testHistory.testPath.baseName(),
        ]);

        let nextLineIsOdd = true; // Use alternating background colors to make lines easier to follow
        let lastTestDirName: string | null = null;
        for (let testHistory of outcomeHistories) {
            // Add an empty line between test sets from different directories
            if (lastTestDirName != null && testHistory.testPath.dirName() != lastTestDirName) {
                lines.push({text: "", bgColorCode: "\x1b[48;5;237m"});
                nextLineIsOdd = true;
            }
            lastTestDirName = testHistory.testPath.dirName();

            const colorSuffix = nextLineIsOdd ? colorOdd : colorEven;
            lines.push({
                text: `${vtPadLeft(testHistory.getExpectationWithDefault().toString(
                    ToStringMode.WithColors | ToStringMode.PadBugLink, colorSuffix), testNameColumnWidth)}${
                    testHistory.historyString()}${colorSuffix}`,
                bgColorCode: colorSuffix
            });
            const failedRevisionMessage = testHistory.constructFirstFailedRevisionMessage();
            if (failedRevisionMessage) {
                lines.push({
                    text: `${vtPadLeft("", testNameColumnWidth)}${failedRevisionMessage}`,
                    bgColorCode: colorSuffix,
                });
            }

            nextLineIsOdd = !nextLineIsOdd;
        }

        lines.push({text: "", bgColorCode: colorReset});
    }

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
            const paddedText = vtPadLeft(lines[i].text, entireOutputWidth);
            console.log(lines[i].bgColorCode + paddedText + nextLineColorCode);
        }
    }

    return testHistoriesWithInvalidExpectations;
}

const expectationFilePaths = [
    "expectations/platforms/gtk/TestExpectations",
    "expectations/TestExpectations",
];

const testContext: TestContext = {platform: "gtk", buildType: BuildType.Release};
const allExpectations: TestExpectation[] = Array.prototype.concat.apply([], expectationFilePaths
    .map(path => parseExpectations(path)));

const releaseJson: ReleaseJson = JSON.parse(fs.readFileSync("results/gtk-release.json", "utf-8"));
if ((<any>releaseJson).version != 4) {
    console.warn("release.json format version has changed!");
}

const botTestsResults = parseReleaseJson(testContext, releaseJson);
findTestsWithInvalidExpectations(botTestsResults);