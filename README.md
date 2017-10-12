# WebKit auto-gardener

This is a simplified WebKit gardening dashboard that makes easier to report regressions.

## How is different from the flakiness dashboard?

 * Faster and lighter.
 * Only tests with failed expectations in the last revision are shown.
 * Tests are grouped and ordered in a way that makes it easier to report bugs (first by failure type, then directory, then old bug id, then alphabetically). Less need for Ctrl+F.
 * Alternating background lines make it easier to match each test with its outcome history.
 * The first failing revision is displayed directly in an easy to copy way, no need for popups.

## Installation

1. Clone the repository.

2. Run `npm install`.

## Usage

```
./download-results
./auto-gardener gtk-release
```

## FAQ

### Why is the output empty?

The build may have fail and therefore there are no data for the tests in the last revision.
