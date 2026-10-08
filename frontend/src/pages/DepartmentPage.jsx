import { useParams, NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getDepartment } from '../data/departmentConfig';
import DepartmentOverview from '../components/DepartmentOverview';
import DepartmentWorkspace from '../components/DepartmentWorkspace';
import DepartmentTasks from '../components/DepartmentTasks';
import JobOutreach from './JobOutreach';
import Research from './Research';
import BriefingDashboard from './BriefingDashboard';

function EmbeddedOutreach() { return <JobOutreach embedded />; }
function EmbeddedResearch() { return <Research embedded />; }
function EmbeddedIntelligence() { return <BriefingDashboard embedded />; }

const TAB_CONTENT = {
  outreach: EmbeddedOutreach,
  research: EmbeddedResearch,
  intelligence: EmbeddedIntelligence,
};

export default function DepartmentPage() {
  const { deptKey } = useParams();
  const dept = getDepartment(deptKey);

  if (!dept) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-muted)]">Department not found.</p>
        <Link to="/departments" className="text-sm text-[var(--color-accent)] mt-2 inline-block">
          Back to Departments
        </Link>
      </div>
    );
  }

  const Icon = dept.icon;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      {/* Back link */}
      <Link
        to="/departments"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4"
      >
        <ArrowLeft size={12} /> Departments
      </Link>

      {/* Hero header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-md bg-[var(--color-accent-dim)] flex items-center justify-center shrink-0">
          <Icon size={20} className="text-[var(--color-accent)]" />
        </div>
        <div>
          <h1 className="font-[var(--font-display)] text-xl font-semibold">{dept.label}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">{dept.description}</p>
        </div>
      </div>

      {/* Inner tab bar */}
      <div className="mt-5 mb-6 border-b border-[var(--color-border)] overflow-x-auto scrollbar-hide">
        <nav className="flex gap-0 min-w-max">
          {dept.tabs.map((tab) => {
            const to = tab.key === 'overview'
              ? `/departments/${deptKey}`
              : `/departments/${deptKey}/${tab.key}`;
            return (
              <NavLink
                key={tab.key}
                to={to}
                end={tab.key === 'overview'}
                className={({ isActive }) =>
                  `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-[var(--color-accent)] text-[var(--color-text)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <Routes>
        <Route index element={<><DepartmentWorkspace departmentKey={deptKey} /><DepartmentOverview departmentKey={deptKey} /></>} />
        <Route path="approvals" element={<DepartmentTasks departmentKey={deptKey} />} />
        {dept.tabs
          .filter((t) => t.key !== 'overview' && t.key !== 'approvals' && TAB_CONTENT[t.key])
          .map((t) => {
            const Content = TAB_CONTENT[t.key];
            return <Route key={t.key} path={t.key} element={<Content />} />;
          })}
        <Route path="*" element={<Navigate to={`/departments/${deptKey}`} replace />} />
      </Routes>
    </div>
  );
}
