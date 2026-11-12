import { Outlet } from 'react-router-dom';
import PageTabs from '../PageTabs';
import { navItem } from './navConfig';
import { useNavBadges } from './useNavBadges';
import { useStore } from '../../store/useStore';

/**
 * A tabbed parent page: the tab bar from navConfig, then the active tab's page
 * (the nested route) unchanged. `fill` keeps full-height pages like Chat
 * filling the screen below the tabs instead of scrolling under them.
 */
export default function TabbedLayout({ navKey, fill = false }) {
  const item = navItem(navKey);
  const badges = useNavBadges();
  const isAppOwner = useStore((s) => !!s.user?.isAppOwner);
  const isOwnerRole = useStore((s) => s.user?.role === 'owner');
  const visible = item.tabs.filter((t) => (!t.ownerOnly || isAppOwner) && (!t.ownerRoleOnly || isOwnerRole));
  const tabs = <PageTabs tabs={visible} variant={item.tabsVariant} badges={badges} />;

  if (fill) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 px-4 md:px-6 pt-3 md:pt-4">{tabs}</div>
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="px-4 md:px-6 pt-3 md:pt-4">{tabs}</div>
      <Outlet />
    </div>
  );
}
