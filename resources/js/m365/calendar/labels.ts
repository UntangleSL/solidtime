// Copy stays server-side (English now, Spanish prepared); only client data values are filled in
// here. Placeholders look like `:name`; unknown placeholders are left untouched.
export function fillLabel(template: string, values: Record<string, string>): string {
    return template.replace(/:([a-z_]+)/gi, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? (values[name] as string) : match
    );
}
