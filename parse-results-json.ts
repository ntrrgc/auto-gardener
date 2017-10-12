import * as fs from "fs";
import {
    BotsTestResults,
    Path,
    TestExpectation,
    TestHistory,
    TestOutcome,
    TestResult
} from "./main";
import {ensure, maxBy} from "./functional-utils";
import {BuildType, TestContext} from "./contexts";

interface JSONTestsResultsRoot {
    [platformName: string]: JSONTestsResultsPlatform;
}

interface JSONTestsResultsPlatform {
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

function getTestsResultsJsonPlatformName(jsonRoot: JSONTestsResultsRoot) {
    for (let key in jsonRoot) {
        if (key != "version") {
            return key;
        }
    }
    throw new Error("Could not find platform name in tests results JSON root.");
}

function parseOutcomeString(outcomeString: JSONTestOutcomeLetter): TestOutcome {
    const outcomeDict: { [key: string]: TestOutcome } = {
        "N": TestOutcome.NoData, // no data,
        "P": TestOutcome.Pass,
        "F": TestOutcome.Failure,
        "C": TestOutcome.Crash,
        "T": TestOutcome.Timeout,
        "I": TestOutcome.ImageOnlyFailure,
        "A": TestOutcome.Failure, // AudioOnlyFailure?
        "O": TestOutcome.Missing,
        "X": TestOutcome.Skip,
    };
    if (!(outcomeString in outcomeDict)) {
        throw new Error(`Unknown test outcome string: "${outcomeString}"`);
    }
    return outcomeDict[outcomeString];
}

function findMostSpecificExpectation(allExpectations: TestExpectation[],
                                     testPath: Path,
                                     buildType: BuildType): TestExpectation | null {
    const matches = allExpectations.filter(expectation => expectation.matchesTest(testPath, buildType));
    return maxBy(matches, expectation => expectation.testPath.entries.length);
}

export function constructBotTestsResultsFromJson(context: TestContext,
                                                 allExpectations: TestExpectation[],
                                                 testsResultsPath: string): BotsTestResults {
    const resultsJson: JSONTestsResultsRoot = JSON.parse(fs.readFileSync(testsResultsPath, "utf-8"));
    if ((<any>resultsJson).version != 4) {
        console.warn("JSON format version has changed!");
    }

    const jsonReleasePlatform = resultsJson[getTestsResultsJsonPlatformName(resultsJson)];
    const collectedTestHistories = new Array<TestHistory>();
    const webkitRevisions = jsonReleasePlatform.webkitRevision.map(x => parseInt(x));

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