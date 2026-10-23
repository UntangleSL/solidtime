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
      };
