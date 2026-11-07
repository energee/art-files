// userGuide.ts — Help > User Guide. The guide is a hosted site (docs-site/,
// published by docs-deploy.yml). On desktop the opener plugin hands the URL to
// the default browser, and the capability allows this URL and no other.
import { isTauri } from "@tauri-apps/api/core";
import { t } from "@/i18n";
import { errMsg } from "@/lib/utils";
import { notify } from "@/notify";

export const USER_GUIDE_URL = "https://energ.ee/label-lab-docs/docs";

export async function openUserGuide(): Promise<void> {
  if (!isTauri()) {
    window.open(USER_GUIDE_URL, "_blank", "noopener");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(USER_GUIDE_URL);
  } catch (err) {
    notify.error(t("Couldn't open the User Guide"), { description: errMsg(err) });
  }
}
