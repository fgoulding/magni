// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickWorkout, TodayWorkoutDashboard, TodayWorkoutSummary } from '@/features/programs/program-service';

type MutableDashboard = { -readonly [K in keyof TodayWorkoutDashboard]: TodayWorkoutDashboard[K] };

const state = vi.hoisted(() => ({
  dashboard: { activeWorkouts: [], scheduledToday: [], missedWorkouts: [], otherActiveRuns: [] } as MutableDashboard,
  quick: null as QuickWorkout | null,
}));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ id: 1, email: 'today@example.test' }), getSettingNumber: () => 2.5 }));
vi.mock('@/lib/user-date', () => ({ userDateKey: () => '2026-09-06' }));
vi.mock('@/lib/db', () => ({ db: { prepare: () => ({ get: () => undefined }) } }));
vi.mock('@/features/programs/program-service', () => ({ getTodayWorkoutDashboard: () => state.dashboard, getQuickWorkoutForToday: () => state.quick, getProgramLibrary: () => ({ activeRuns: [] }) }));
vi.mock('@/features/workouts/history-service', () => ({ getWorkout: () => null }));
vi.mock('@/components/WorkoutCard', () => ({ WorkoutCard: (props: { occurrenceId?: number; resumeSessionId?: number; programId: number; dayName: string; scheduledDate?: string }) => <section aria-label="Primary workout" data-occurrence-id={props.occurrenceId} data-resume-session-id={props.resumeSessionId} data-program-id={props.programId} data-scheduled-date={props.scheduledDate}><h2>{props.dayName}</h2><button>Start Workout</button></section> }));
vi.mock('@/components/QuickWorkout', () => ({ QuickWorkout: ({ initialSession }: { initialSession: QuickWorkout | null }) => initialSession ? <section aria-label="Active quick workout">{initialSession.name}</section> : <button>Quick workout</button> }));
vi.mock('@/components/ProgramHoldForm', () => ({ ProgramHoldDialog: () => null }));
import TodayPage from './page';

function row(id: number, change: Partial<TodayWorkoutSummary> = {}): TodayWorkoutSummary {
  return { program_id: id, program_run_id: id, program_name: `Program ${id}`, current_week: 1, current_day: 1, schedule_weekdays: '[0,1,2,3,4,5,6]', schedule_mode: 'scheduled', schedule_start_date: '2026-09-01', num_weeks: 4, day_id: id, legacy_day_id: id, definition_day_id: id, day_name: `Day ${id}`, day_number: 1, shared_day_key: null, occurrence_id: id, schedule_label: 'Sun', scheduled_date: '2026-09-06', last_session_date: null, today_session_id: null, today_session_status: null, next_lifts: [{ name: 'Squat', set_count: 3, reps: 5, weight: 100, bodyweight: false }], ...change };
}
beforeEach(() => { state.dashboard = { activeWorkouts: [], scheduledToday: [], missedWorkouts: [], otherActiveRuns: [] }; state.quick = null; });
afterEach(cleanup);

describe('focused Today layout', () => {
  it('shows one today logger and compact exact-occurrence links for other today and overdue workouts', async () => {
    state.dashboard.scheduledToday = [row(1), row(2)];
    state.dashboard.missedWorkouts = [row(3, { scheduled_date: '2026-09-04' }), row(4, { scheduled_date: '2026-09-05' })];
    render(await TodayPage({}));
    expect(screen.getAllByRole('region', { name: 'Primary workout' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-occurrence-id', '1');
    expect(screen.getByRole('link', { name: /Program 2.*Day 2/ })).toHaveAttribute('href', '/calendar?month=2026-09&date=2026-09-06&workout=occurrence-2');
    expect(screen.getByRole('link', { name: /Program 3.*Day 3/ })).toHaveAttribute('href', '/calendar?month=2026-09&date=2026-09-04&workout=occurrence-3');
    expect(screen.getByRole('link', { name: 'Quick workout' })).toHaveAttribute('href', '/workouts/new?date=2026-09-06');
    expect(screen.queryByRole('button', { name: 'Quick workout' })).not.toBeInTheDocument();
  });
  it('keeps an old active session primary and links every other active session by its exact ID', async () => {
    state.dashboard.activeWorkouts = [row(5, { scheduled_date: '2026-09-01', today_session_id: 50 }), row(6, { scheduled_date: '2026-09-02', today_session_id: 60 })];
    state.dashboard.scheduledToday = [row(7)];
    render(await TodayPage({}));
    expect(screen.getAllByRole('region', { name: 'Primary workout' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-occurrence-id', '5');
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-scheduled-date', '2026-09-01');
    expect(screen.getByRole('link', { name: /Resume.*Program 6.*Day 6/ })).toHaveAttribute('href', '/workouts/60');
    expect(screen.getByRole('link', { name: /Program 7.*Day 7/ })).toHaveAttribute('href', '/calendar?month=2026-09&date=2026-09-06&workout=occurrence-7');
  });
  it('makes a past unplanned session the only logger while planned active sessions remain resumable', async () => {
    state.quick = { id: 80, name: 'Past quick session', date: '2026-09-01', unit: 'lb', revision: 0, sets: [] };
    state.dashboard.activeWorkouts = [row(8, { today_session_id: 81 })];
    state.dashboard.scheduledToday = [row(9)];
    render(await TodayPage({}));
    expect(screen.getByRole('region', { name: 'Active quick workout' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Primary workout' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Resume.*Program 8.*Day 8/ })).toHaveAttribute('href', '/workouts/81');
  });
  it('does not promote missed sessions into today and keeps the empty quick starter available', async () => {
    state.dashboard.missedWorkouts = [row(10, { scheduled_date: '2026-09-03' })];
    render(await TodayPage({}));
    expect(screen.queryByRole('region', { name: 'Primary workout' })).not.toBeInTheDocument();
    expect(screen.getByText('No workout scheduled today')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quick workout' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Program 10.*Day 10/ })).toHaveAttribute('href', '/calendar?month=2026-09&date=2026-09-03&workout=occurrence-10');
  });
  it('lets an owned unscheduled program be chosen without stacking its logger or exposing another user program', async () => {
    state.dashboard.otherActiveRuns = [row(11, { occurrence_id: undefined, scheduled_date: undefined }), row(12, { occurrence_id: undefined, scheduled_date: undefined })];
    const first = render(await TodayPage({ searchParams: Promise.resolve({ program: '12' }) }));
    expect(screen.getAllByRole('region', { name: 'Primary workout' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-program-id', '12');
    expect(screen.getByRole('link', { name: /Program 11.*Day 11/ })).toHaveAttribute('href', '/today?program=11');
    first.unmount();
    render(await TodayPage({ searchParams: Promise.resolve({ program: '999' }) }));
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-program-id', '11');
  });
  it('keeps completed today status and history access when the next workout is shown', async () => {
    state.dashboard.scheduledToday = [row(13, { today_session_id: 130, today_session_status: 'completed' }), row(14)];
    render(await TodayPage({}));
    expect(screen.getByText('Workout complete today')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Workout details' })).toHaveAttribute('href', '/workouts/130');
    expect(screen.getAllByRole('region', { name: 'Primary workout' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-occurrence-id', '14');
  });
  it('keeps an active session primary even when an alternate program URL is requested', async () => {
    state.dashboard.activeWorkouts = [row(15, { today_session_id: 150, scheduled_date: '2026-09-01' })];
    state.dashboard.otherActiveRuns = [row(16, { occurrence_id: undefined, scheduled_date: undefined })];
    render(await TodayPage({ searchParams: Promise.resolve({ program: '16' }) }));
    expect(screen.getAllByRole('region', { name: 'Primary workout' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-occurrence-id', '15');
    expect(screen.getByRole('link', { name: /View program.*Program 16.*Day 16/ })).toHaveAttribute('href', '/programs/16');
  });
  it('resumes an unlinked manual active session by exact ID and keeps account details out of the training header', async () => {
    state.dashboard.activeWorkouts = [row(17, { occurrence_id: undefined, today_session_id: 170, scheduled_date: undefined, last_session_date: '2026-09-01' })];
    render(await TodayPage({}));
    expect(screen.getByRole('region', { name: 'Primary workout' })).toHaveAttribute('data-resume-session-id', '170');
    expect(screen.getByRole('region', { name: 'Primary workout' })).not.toHaveAttribute('data-scheduled-date');
    expect(screen.getByRole('heading', { name: 'Today' })).toBeVisible();
    expect(screen.queryByText('today@example.test')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workout history' }).closest('header')).not.toBeNull();
  });
});
