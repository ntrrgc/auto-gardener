export enum BuildType {
    Debug,
    Release
}

export interface TestContext {
    /** string used to select this context in the application */
    id: string;

    botsPlatformName: string;
    platform: "gtk" | "wpe";
    buildType: BuildType;
    testExpectationPaths: string[]; // the path with the most priority comes first
}

export const availableContexts: TestContext[] = [
    {
        id: "gtk-debug",
        botsPlatformName: "GTK Linux 64-bit Debug (Tests)",
        platform: "gtk",
        buildType: BuildType.Debug,
        testExpectationPaths: [
            "platform/gtk/TestExpectations",
            "platform/wk2/TestExpectations",
            "TestExpectations",
        ],
    },
    {
        id: "gtk-release",
        botsPlatformName: "GTK Linux 64-bit Release (Tests)",
        platform: "gtk",
        buildType: BuildType.Release,
        testExpectationPaths: [
            "platform/gtk/TestExpectations",
            "platform/wk2/TestExpectations",
            "TestExpectations",
        ],
    },
    {
        id: "gtk-release-wayland",
        botsPlatformName: "GTK Linux 64-bit Release Wayland (Tests)",
        platform: "gtk",
        buildType: BuildType.Release,
        testExpectationPaths: [
            "platform/gtk-wayland/TestExpectations",
            "platform/gtk/TestExpectations",
            "platform/wk2/TestExpectations",
            "TestExpectations",
        ],
    },
    {
        id: "wpe-release",
        botsPlatformName: "WPE Linux 64-bit Release (Tests)",
        platform: "wpe",
        buildType: BuildType.Release,
        testExpectationPaths: [
            "platform/wpe/TestExpectations",
            "platform/gtk/TestExpectations",
            "platform/wk2/TestExpectations",
            "TestExpectations",
        ],
    },
];