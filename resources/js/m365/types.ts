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
    urls: { meetings: string; sync: string };
    labels: OutlookCalendarLabels;
}
