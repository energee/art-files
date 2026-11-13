// SettingsNav.tsx — what the sidebar shows while the Settings page is open:
// Back, then one row per settings group. A row scrolls the page to its
// group (`#settings-<id>`, rendered by RenderSettings).
import { ArrowLeft } from "lucide-react";
import { SETTINGS_GROUPS } from "@/settings";
import { useTranslation } from "@/i18n";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

export function SettingsNav({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <SidebarMenu data-settings-nav className="p-2">
      <SidebarMenuItem>
        <SidebarMenuButton data-settings-back onClick={onBack}>
          <ArrowLeft />{t("Back")}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {SETTINGS_GROUPS.map((group) => (
        <SidebarMenuItem key={group.id}>
          <SidebarMenuButton data-group={group.id}
            onClick={() => document.getElementById(`settings-${group.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}>
            {t(group.title)}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
