// Full-page navigation. The Microsoft OAuth redirect is cross-origin, so it must not go through
// Inertia's router or <Link> (those issue an XHR that fails on the redirect). Kept as a module
// function so component tests can mock it instead of touching window.location.
export function navigateTo(url: string): void {
    window.location.assign(url);
}
