import {groupBy, sortedBy} from "./functional-utils";
import {printVtLines, VtLine, vtPadLeft} from "./vt-utils";
import {parseExpectations} from "./parse-expectations";
import {constructBotTestsResultsFromJson} from "./parse-results-json";
import {availableContexts, BuildType, TestContext} from "./contexts";

export enum TestOutcome {
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

export function testOutcomeToLetter(outcome: TestOutcome): string {
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
        case TestOutcome.Skip:
            return "X";
        case TestOutcome.WontFix:
            return "W";
        default:
            throw new Error(`Unexpected outcome: ${TestOutcome[outcome]} (${outcome})`);
    }
}

export function testOutcomeToColor(outcome: TestOutcome, colorType: "bg" | "fg"): string {
    const prefix = colorType == "bg" ? "\x1b[48;5;" : "\x1b[38;5;";
    switch (outcome) {
        case TestOutcome.NoData:
        case TestOutcome.Missing:
        case TestOutcome.Skip:
        case TestOutcome.WontFix:
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

export enum ToStringMode {
    Normal = 0,
    WithColors = 1,
    PadBugLink = 2,
}

export class TestExpectation {
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

export class Path {
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


export interface TestResult {
    webkitRevision: number;
    outcome: TestOutcome;
}

export interface BotsTestResults {
    context: TestContext;
    webkitRevisions: number[]; //most recent first
    testHistories: TestHistory[];
}

export type RevisionRange = number | {start: number, end: number} | "long ago" | "never failed";

export class TestHistory {
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

    findFirstFailedRevisionRange(countRevisionsInBuild: number): RevisionRange {
        let wasWorkingOnRevision: number | null = null;
        for (let i = this.lastResults.length - 1; i >= 0; i--) {
            const result = this.lastResults[i];
            const resultMatchesExpectation = this.matchesExpectation(result.webkitRevision);
            if (resultMatchesExpectation == false) {
                if (wasWorkingOnRevision == null) {
                    // First data we have on the test is already a failure
                    if (this.lastResults.length >= countRevisionsInBuild) {
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

    constructFirstFailedRevisionMessage(countRevisionsInBuild: number): string | null {
        const firstFailedRange = this.findFirstFailedRevisionRange(countRevisionsInBuild);
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

function formatContext(context: TestContext) {
    return `${context.platform.toUpperCase()} ${BuildType[context.buildType]}`;
}

function findTestsWithInvalidExpectations(botTestsResults: BotsTestResults): TestHistory[] {
    const latestRevision = botTestsResults.webkitRevisions[0];
    const countRevisions = botTestsResults.webkitRevisions.length;

    const colorReset = "\x1b[0m";
    const testNameColumnWidth = 131;
    const consoleWidth = 231;

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
            const failedRevisionMessage = testHistory.constructFirstFailedRevisionMessage(countRevisions);
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

    printVtLines(lines, consoleWidth);

    return testHistoriesWithInvalidExpectations;
}

function printAvailableContexts() {
    console.log();
    console.log("Available contexts:");
    for (let ctx of availableContexts) {
        console.log(`  ${ctx.id}`);
    }
}

function main() {
    if (process.argv.length != 3) {
        console.log("Usage: auto-gardener <context-id>");
        printAvailableContexts();
        process.exit(1);
        return;
    }

    const chosenContextId = process.argv[2];

    const testContext = availableContexts.find(ctx => ctx.id == chosenContextId);
    if (!testContext) {
        console.error(`Unknown context: ${chosenContextId}`);
        printAvailableContexts();
        process.exit(1);
        return;
    }

    const allExpectations: TestExpectation[] = Array.prototype.concat.apply([],
        testContext.testExpectationPaths.map(
            path => parseExpectations(`${__dirname}/expectations/${path}`)));

    const botTestsResults = constructBotTestsResultsFromJson(testContext, allExpectations,
        `${__dirname}/results/${testContext.id}.json`);

    findTestsWithInvalidExpectations(botTestsResults);
}

main();