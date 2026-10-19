// Scenario tags, extraction and the fixture manifest for the Outlook spike.
// Zero dependencies (node: built-ins only).
export const REQUIRED_SCENARIOS = [
    'S1',
    'S1b',
    'S2',
    'S3',
    'S4',
    'S5',
    'S5b',
    'S6',
    'S6b',
    'S7',
    'S8',
];
export const OPTIONAL_SCENARIOS = ['S7b', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

// Every test event carries "[M365-TEST <ID>]" in its subject (Exchange may prepend "Canceled:" and
// similar, so the tag is searched, not anchored). It is the only thing that lets an event reach a
// committed fixture: an event without the tag is never written, not even pseudonymized.
export const SCENARIO_TAG = /\[M365-TEST (S\d+[a-z]?|E\d+)\]/;

export function scenarioIdOf(subject) {
    if (typeof subject !== 'string') {
        return null;
    }
    const match = SCENARIO_TAG.exec(subject);
    return match ? match[1] : null;
}
