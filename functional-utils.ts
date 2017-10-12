export function compareArrays<T>(a: T[], b: T[]): number {
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

export function maxBy<T, W>(array: T[], predicate: (item: T) => W): T | null {
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

export function groupBy<K, T>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
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

function compareArraysUnitTests() {
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

export function sortedBy<T, K>(items: Iterable<T>, keyFn: (item: T) => K[]): T[] {
    const ret = Array.from(items);
    ret.sort((a, b) => {
        const ka = keyFn(a);
        const kb = keyFn(b);
        return compareArrays(ka, kb);
    });
    return ret;
}