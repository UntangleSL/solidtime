// Mirrors the server-side `microsoft` shared Inertia prop (ShareMicrosoftInertiaData). All copy is
// resolved on the server (English now, Spanish prepared), so the UI never hard-codes strings.
export interface MicrosoftAccountLabels {
    section_title: string;
    section_description: string;
    connected_as: string;
    not_connected: string;
    disconnected_status: string;
    connect: string;
    disconnect: string;
    disconnect_title: string;
    disconnect_body: string;
    disconnect_body_passwordless: string;
    cancel: string;
}

export interface MicrosoftAccountProps {
    linked: boolean;
    connected: boolean;
    email: string | null;
    has_password: boolean;
    connect_url: string;
    disconnect_url: string;
    notice: string | null;
    labels: MicrosoftAccountLabels;
}

export type MicrosoftSharedProps =
    | { enabled: false }
    | {
          enabled: true;
          login_url: string;
          labels: { sign_in: string; sign_in_hint: string };
          // Only present on profile.show
          account?: MicrosoftAccountProps;
          // Only present on the calendar route
          calendar?: OutlookCalendarProps;
      };

// Outlook meeting as served by the server-side OutlookMeetingResource. `start` and `end` are UTC
// ISO strings with a Z suffix; positions are always computed in the user's solidtime timezone.
export interface OutlookMeeting {
    id: string;
    subject: string | null;
    start: string;
    end: string;
    organizer_name: string | null;
    is_organizer: boolean;
    is_online_meeting: boolean;
    web_link: string | null;
    dismissed: boolean;
    // Phase 5 fields. Optional so fixtures and cached reads written before Phase 5 stay valid;
    // readers treat a missing value as null / false / [] (not recurring, not ignored, no
    // assignment, no suggestions).
    // Stable key of the recurring series (null for a one-off meeting).
    series_key?: string | null;
    // The user chose "Always ignore this series": shown faded like a dismissed meeting.
    series_ignored?: boolean;
    // The series pre-assignment learned from the last conversion of this series (D-02).
    assignment?: OutlookAssignment | null;
    // At most 3, server order; only the first may be confident; empty when an assignment exists.
    suggestions?: OutlookSuggestion[];
}

// Series pre-assignment of a recurring meeting (the project, task, tags and billable used the last
// time a meeting of the series was converted).
export interface OutlookAssignment {
    project_id: string;
    project_name: string;
    project_color: string;
    client_name: string | null;
    task_id: string | null;
    task_name: string | null;
    tags: string[];
    billable: boolean;
    converted_at: string;
}

// Why the server suggests a project (D-07, RULE-05). For 'domain' the value is the bare domain
// (the '@' lives in the copy); for 'subject' it is null.
export type OutlookReasonKind = 'domain' | 'person' | 'organizer' | 'subject';

export interface OutlookSuggestionReason {
    kind: OutlookReasonKind;
    count: number;
    value: string | null;
}

export interface OutlookSuggestion {
    project_id: string;
    project_name: string;
    project_color: string;
    client_name: string | null;
    confident: boolean;
    reason: OutlookSuggestionReason;
}

// Where the form's project prefill came from (D-16), sent with the conversion for measurement.
export type OutlookPrefillSource = 'series' | 'suggestion' | 'last_used' | 'none';

// Body fields to confirm pre-assigned meetings with their series assignment (sent alone with
// meeting_ids: no project, task, tags, billable, description, start, end or prefill fields).
export interface OutlookSeriesConfirmFields {
    use_series_assignment: true;
}

// Calendar copy resolved on the server (microsoft365.calendar.*), served as microsoft.calendar.labels.
// Some values hold :name placeholders that the client fills with data (see fillLabel).
export interface OutlookCalendarLabels {
    no_subject: string;
    ghost_label: string;
    layer_label: string;
    dismissed_suffix: string;
    sync: string;
    sync_aria: string;
    syncing: string;
    last_synced: string;
    empty: string;
    empty_hint: string;
    unavailable: string;
    unavailable_cached_hint: string;
    no_mailbox: string;
    connect: string;
    connect_hint: string;
    reconnect: string;
    reconnect_hint: string;
    eyebrow: string;
    eyebrow_dismissed: string;
    organized_by: string;
    you_organize: string;
    online: string;
    open_in_outlook: string;
    opens_new_tab: string;
    dismiss: string;
    restore: string;
    dismiss_failed: string;
    restore_failed: string;
    retry_body: string;
    dismissed_announcement: string;
    restored_announcement: string;
    settings_heading: string;
    show_dismissed: string;
    show_dismissed_help: string;
    lane_caption_time: string;
    lane_caption_outlook: string;
    hover_hint: string;
    sync_in: string;
    sync_cooldown_hint: string;
    sync_backoff_hint: string;
    // Phase 4 (meeting conversion and multi-select); mirror microsoft365.calendar.* like the rest.
    create_entry: string;
    create_submit: string;
    form_context: string;
    field_description: string;
    field_project: string;
    field_start: string;
    field_end: string;
    error_project_required: string;
    error_end_before_start: string;
    hover_hint_select: string;
    hover_hint_select_mac: string;
    select: string;
    deselect: string;
    selected_suffix: string;
    selection_label: string;
    selected_one: string;
    selected_many: string;
    selection_cleared: string;
    clear_selection: string;
    assign_one: string;
    assign_many: string;
    batch_note: string;
    batch_submit_one: string;
    batch_submit_many: string;
    batch_summary: string;
    batch_none: string;
    batch_success_many: string;
    retry_failed: string;
    close: string;
    row_created: string;
    row_existing: string;
    created_announcement: string;
    from_meeting: string;
    error_forbidden_project: string;
    error_meeting_gone: string;
    error_generic: string;
    cancel: string;
    description_placeholder: string;
    tags: string;
    tags_one: string;
    tags_many: string;
    billable: string;
    non_billable: string;
    created_success: string;
    // Phase 5 (series pre-assignment and smart suggestions).
    preassigned_suffix: string;
    preassigned_eyebrow: string;
    why_series: string;
    confirm: string;
    edit: string;
    more_actions: string;
    confirm_failed: string;
    ignore_series: string;
    unignore_series: string;
    forget_series: string;
    series_ignored: string;
    series_ignored_help: string;
    series_unignored: string;
    series_forgotten: string;
    series_forgotten_help: string;
    series_action_failed: string;
    eyebrow_series_ignored: string;
    series_ignored_suffix: string;
    reason_series: string;
    reason_last_used: string;
    reason_domain_one: string;
    reason_domain_many: string;
    reason_person_one: string;
    reason_person_many: string;
    reason_organizer_one: string;
    reason_organizer_many: string;
    reason_subject_one: string;
    reason_subject_many: string;
    reason_batch: string;
    other_suggestions: string;
    use_suggestion: string;
    series_note_new: string;
    series_note_change: string;
    batch_series_note: string;
    confirm_all_short: string;
    confirm_all_long: string;
    confirm_all_tooltip: string;
    confirm_all_title_one: string;
    confirm_all_title_many: string;
    confirm_all_note: string;
    confirm_submit_one: string;
    confirm_submit_many: string;
    confirm_none_selected: string;
    include_meeting: string;
    row_upcoming: string;
    error_no_assignment: string;
}

// 'connected': Graph access works; 'reconnect': the Microsoft grant expired or lacks the calendar
// scope; 'not_connected': no linked or disconnected account (MicrosoftAccount::calendarAccessState).
export type OutlookConnectionState = 'connected' | 'reconnect' | 'not_connected';

export interface OutlookSyncInfo {
    last_synced_at: string | null;
    retry_after: number | null;
}

// GET /m365/meetings
export interface OutlookMeetingsResponse {
    data: OutlookMeeting[];
    sync: OutlookSyncInfo;
    // Ids of the user's time entries created from a meeting (the Outlook icon on entries, D-04).
    // fetchMeetings always sets it (empty when absent or malformed); optional so cache entries and
    // fixtures written without it stay valid, readers treat a missing list as empty.
    linked_time_entry_ids?: string[];
}

export type OutlookSyncStatus =
    | 'ok'
    | 'reused'
    | 'coalesced'
    | 'throttled'
    | 'unavailable'
    | 'reconnect'
    | 'not_connected'
    | 'no_mailbox';

// POST /m365/meetings/sync (HTTP 200 for every expected degradation)
export interface OutlookSyncResponse {
    status: OutlookSyncStatus;
    retry_after: number | null;
    last_synced_at: string | null;
    truncated: boolean;
}

// The `microsoft.calendar` shared prop, only present on the calendar route.
export interface OutlookCalendarProps {
    state: OutlookConnectionState;
    // `convert` is the conversion endpoint of the user's current organization (null without one);
    // optional so fixtures written before Phase 4 keep compiling.
    urls: { meetings: string; sync: string; convert?: string | null };
    // Phase 2 connect flow that returns to the calendar (Connect and Reconnect navigate here)
    connect_url: string;
    // One-time outcome of a connect that returned to the calendar, shown as a notification
    notice: { level: 'success' | 'error'; message: string } | null;
    labels: OutlookCalendarLabels;
}

// POST calendar.urls.convert (one result per requested meeting, in request order). 'existing' means
// the occurrence already had a time entry (D-06): the server returns that entry instead of a new one.
export type OutlookConversionStatus = 'created' | 'existing' | 'failed';

export interface OutlookConversionResult {
    meeting_id: string;
    status: OutlookConversionStatus;
    time_entry_id: string | null;
    // Only for 'failed'; the message is already localized by the server.
    error: { key: string; message: string } | null;
}

// The entry fields of a conversion. description, start and end apply to a single meeting only
// (start and end both or neither, UTC 'YYYY-MM-DDTHH:mm:ssZ').
export interface OutlookConversionFields {
    project_id: string;
    task_id: string | null;
    tags: string[];
    billable: boolean;
    description?: string | null;
    start?: string;
    end?: string;
    // Phase 5 (D-16): where the form's project prefill came from and which project it was, so the
    // server can measure how often the prefill is kept.
    prefill_source?: OutlookPrefillSource | null;
    prefill_project_id?: string | null;
}
