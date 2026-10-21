import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Bot,
  Brain,
  Check,
  ChevronsUpDown,
  Clock,
  Code2,
  DatabaseZap,
  Fingerprint,
  LogOut,
  MessageSquare,
  PanelTopOpen,
  Plus,
  Server,
  Settings,
  Vault,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MobileNavButton, NavButton } from '@/console/components'
import type { Project } from '@/lib/enborrpc'
import { signOut } from '@/lib/oidc'
import { CreateProjectSheet } from './CreateProjectSheet'
import { useConsoleContext } from './console-context'

export function ConsoleShell({ children }: { children: ReactNode }) {
  const context = useConsoleContext()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [creatingProject, setCreatingProject] = useState(false)
  const fullBleed = /^\/sessions\/[^/]+/.test(location.pathname)
  function selectProject(projectId: string) {
    context.selectProject(projectId)
    void queryClient.invalidateQueries()
  }
  return (
    <main className="min-h-screen bg-muted/40 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-background px-4 py-5 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Enbor</p>
            <ProjectSwitcher
              projects={context.projects}
              currentProjectId={context.auth.project.id}
              currentProjectName={context.auth.project.name}
              onSelect={selectProject}
              onCreate={() => setCreatingProject(true)}
            />
          </div>
        </div>
        <DesktopNav />
        <UserMenu placement="sidebar" />
      </aside>

      <section className="lg:pl-64">
        <div className="border-b bg-background px-4 py-4 lg:hidden">
          <div className="mb-3 min-w-0">
            <p className="truncate text-sm font-medium">Enbor</p>
            <ProjectSwitcher
              projects={context.projects}
              currentProjectId={context.auth.project.id}
              currentProjectName={context.auth.project.name}
              onSelect={selectProject}
              onCreate={() => setCreatingProject(true)}
            />
          </div>
          <MobileNav />
        </div>

        <div
          data-console-content={fullBleed ? 'full-bleed' : 'contained'}
          className={fullBleed ? 'p-0' : 'p-4 pb-24 lg:p-8 lg:pb-24'}
        >
          <section
            data-console-surface={fullBleed ? 'full-bleed' : 'contained'}
            className={fullBleed ? 'min-w-0' : 'mx-auto max-w-6xl space-y-4'}
          >
            {children}
          </section>
        </div>
        <UserMenu placement="mobile" />
      </section>
      <CreateProjectSheet open={creatingProject} onOpenChange={setCreatingProject} />
    </main>
  )
}

function ProjectSwitcher({
  projects,
  currentProjectId,
  currentProjectName,
  onSelect,
  onCreate,
}: {
  projects: Project[]
  currentProjectId: string
  currentProjectName: string
  onSelect: (projectId: string) => void
  onCreate: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Switch project"
          className="mt-1 flex max-w-44 items-center gap-1 rounded-sm text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{currentProjectName}</span>
          <ChevronsUpDown size={12} className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
            <span className="truncate">{project.name}</span>
            {project.id === currentProjectId ? <Check size={15} className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus size={15} />
          Create project
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings/projects">
            <PanelTopOpen size={15} />
            Manage projects
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DesktopNav() {
  return (
    <nav className="mt-8 flex-1 space-y-1">
      <NavButton icon={<Bot size={17} />} to="/agents" label="Agents" />
      <NavButton icon={<Fingerprint size={17} />} to="/identities" label="Identities" />
      <NavButton icon={<Server size={17} />} to="/environments" label="Environments" />
      <NavButton icon={<MessageSquare size={17} />} to="/sessions" label="Sessions" />
      <NavButton icon={<Clock size={17} />} to="/triggers" label="Triggers" />
      <NavButton icon={<Vault size={17} />} to="/vaults" label="Vaults" />
      <NavButton icon={<Brain size={17} />} to="/memory-stores" label="Memory" />
      <NavButton icon={<Code2 size={17} />} to="/usage" label="Usage" />
      <NavButton icon={<DatabaseZap size={17} />} to="/audit" label="Audit" />
      <NavButton icon={<Settings size={17} />} to="/settings" label="Settings" />
    </nav>
  )
}

function UserMenu({ placement }: { placement: 'sidebar' | 'mobile' }) {
  const context = useConsoleContext()
  const userName = context.auth.user.name || context.auth.user.email
  const isSidebar = placement === 'sidebar'
  const containerClassName = isSidebar ? 'mt-4 border-t pt-3' : 'fixed bottom-4 left-4 z-20 lg:hidden'
  const triggerClassName =
    placement === 'sidebar'
      ? 'h-12 w-full justify-start gap-3 border-0 bg-transparent px-2 text-left shadow-none ring-0 hover:bg-muted focus-visible:border-0 focus-visible:ring-0 aria-expanded:bg-muted'
      : 'h-11 gap-3 bg-background shadow-sm'
  const triggerVariant = isSidebar ? 'ghost' : 'outline'
  const contentSide = isSidebar ? 'right' : 'top'
  const contentAlign = isSidebar ? 'end' : 'start'

  return (
    <div className={containerClassName}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={triggerVariant} className={triggerClassName} aria-label="User menu">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-xs font-medium text-primary-foreground">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden min-w-0 flex-1 text-left sm:block">
              <span className="block truncate text-sm font-medium">{userName}</span>
              <span className="block truncate text-xs text-muted-foreground">{context.auth.organization.name}</span>
            </span>
            {isSidebar ? <ArrowRight size={15} className="ml-auto text-muted-foreground" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={contentAlign} side={contentSide} sideOffset={10} className="w-64">
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium text-foreground">{userName}</span>
            <span className="block truncate font-normal">{context.auth.user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut size={16} />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MobileNav() {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Primary">
      <MobileNavButton icon={<Bot size={16} />} to="/agents" label="Agents" />
      <MobileNavButton icon={<Fingerprint size={16} />} to="/identities" label="Identities" />
      <MobileNavButton icon={<Server size={16} />} to="/environments" label="Environments" />
      <MobileNavButton icon={<MessageSquare size={16} />} to="/sessions" label="Sessions" />
      <MobileNavButton icon={<Clock size={16} />} to="/triggers" label="Triggers" />
      <MobileNavButton icon={<Vault size={16} />} to="/vaults" label="Vaults" />
      <MobileNavButton icon={<Brain size={16} />} to="/memory-stores" label="Memory" />
      <MobileNavButton icon={<Code2 size={16} />} to="/usage" label="Usage" />
      <MobileNavButton icon={<DatabaseZap size={16} />} to="/audit" label="Audit" />
      <MobileNavButton icon={<Settings size={16} />} to="/settings" label="Settings" />
    </nav>
  )
}
