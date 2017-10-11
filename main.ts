var require: any;
const fs: any = require("fs");

const dontMindUnexpectedPasses = true;

enum TestOutcome {
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

enum BuildType {
    Debug,
    Release
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

    toString() {
        return this.entries.join("/");
    }
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

    toString(): string {
        const parts = new Array<string>();

        for (let bugId of this.bugIds) {
            parts.push(`webkit.org/b/${bugId}`);
        }
        if (this.buildTypeConstraint != null) {
            parts.push(`[ ${BuildType[this.buildTypeConstraint]} ]`);
        }
        parts.push(this.testPath.toString())
        parts.push(`[ ${Array.from(this.expectedOutcomes.values())
            .map(x => TestOutcome[x])
            .join(" ")
        } ]`);

        return parts.join(" ");
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
            if (dontMindUnexpectedPasses) {
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
type JSONTestOutcomeLetter = "F" | "W" | "P" | "I";
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

class TestHistory {
    constructor(public context: TestContext,
                public testPath: Path,
                public lastResults: TestResult[], // most recent first
                public expectation: TestExpectation | null)
    {}

    matchesExpectation(webkitRevision: number): boolean | null {
        const testResult = this.lastResults.find(x => x.webkitRevision == webkitRevision);
        if (!testResult) {
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
}

function getReleaseJsonPlatformName(releaseJson: ReleaseJson) {
    for (let key in releaseJson) {
        if (key != "version") {
            return key;
        }
    }
    throw new Error("Could not find platform name in release.json.");
}

function parseOutcomeString(outcomeString: JSONTestOutcomeLetter): TestOutcome | null {
    const outcomeDict: {[key: string]: TestOutcome|null} = {
        "N": null, // no data,
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
                if (outcome != null && webkitRevisionIndex < webkitRevisions.length) {
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

function findTestsWithInvalidExpectations(botTestsResults: BotsTestResults): TestHistory[] {
    const latestRevision = botTestsResults.webkitRevisions[0];

    const testHistoriesWithInvalidExpectations = botTestsResults.testHistories
        .filter(history => history.matchesExpectation(latestRevision) === false);

    for (let testHistory of testHistoriesWithInvalidExpectations) {
        const expectation = testHistory.getExpectationWithDefault();
        const outcome = testHistory.lastResults.find(r => r.webkitRevision == latestRevision)!.outcome;
        console.log(`${expectation.toString()}, found ${TestOutcome[outcome]}`)
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
const testHistoriesWithInvalidExpectations = findTestsWithInvalidExpectations(botTestsResults);