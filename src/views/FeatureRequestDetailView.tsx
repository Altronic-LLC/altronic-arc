import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lightbulb, User } from "lucide-react";
import {
  useAddFeatureRequestComment,
  useEditFeatureRequestComment,
  useFeatureRequest,
  useFeatureRequests,
  useSetFeatureRequestWatchers,
  useUpdateFeatureRequestFields,
} from "@/hooks/useFeatureRequests";
import { collectFeatureRequestPeople } from "@/api/featureRequests";
import type { Comment, Person } from "@/types/task";
import {
  FEATURE_REQUEST_DEPARTMENTS,
  FEATURE_REQUEST_PRIORITIES,
  FEATURE_REQUEST_STATUSES,
} from "@/types/task";
import { featureRequestLabel } from "@/lib/featureRequestMapper";
import { mergePeople } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PersonMultiField } from "@/components/PersonMultiField";

// =============================================================================
// One ARC Feature Request.
//
// The page is read-only apart from the sidebar (Status/Priority/Department/
// Target Version each save immediately on pick, same as an EIR's sidebar) and
// the comment thread. Requested By is never re-picked — it's set once, on
// create, to whoever submitted the request. No admin gate anywhere: any
// signed-in user can change status/priority/target version.
// =============================================================================

export function FeatureRequestDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const requestId = id ? parseInt(id, 10) : null;
  const { data: request, isLoading } = useFeatureRequest(requestId);
  const { data: requests = [] } = useFeatureRequests();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateFields = useUpdateFeatureRequestFields();
  const setWatchers = useSetFeatureRequestWatchers();
  const addComment = useAddFeatureRequestComment();
  const editComment = useEditFeatureRequestComment();

  const mentionCandidates = useMemo(
    () => mergePeople(collectFeatureRequestPeople(requests), directory),
    [requests, directory],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the request" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That feature request doesn't exist.</p>
        <button
          onClick={() => navigate("/feature-requests")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to Feature Requests
        </button>
      </div>
    );
  }

  function handleAddComment(bodyHtml: string) {
    if (!request) return;
    addComment.mutate({
      id: request.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  function handleWatcherToggle(person: Person) {
    if (!request) return;
    const key = (person.email ?? person.displayName).toLowerCase();
    const watching = request.watchers.some(
      (w) => (w.email ?? w.displayName).toLowerCase() === key,
    );
    const people = watching
      ? request.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...request.watchers, person];
    setWatchers.mutate({ id: request.id, people });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!request) return;
    await editComment.mutateAsync({
      id: request.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
    });
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Feature Requests" listTo="/feature-requests" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ajax-yellow/10 text-ajax-yellow">
          <Lightbulb className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {featureRequestLabel(request)}
          </h1>
          <p className="text-sm text-fg-muted">
            Requested {request.createdAt.toLocaleDateString()}
            {request.requestedBy?.displayName && ` by ${request.requestedBy.displayName}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Description
            </h2>
            {request.description ? (
              <p className="whitespace-pre-wrap text-sm text-fg">{request.description}</p>
            ) : (
              <p className="text-sm text-fg-muted">No description provided.</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                comments={request.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <SidebarField label="Status">
            <ChoiceSelect
              value={request.status}
              onChange={(v) =>
                updateFields.mutate({ id: request.id, fields: { Status: v } })
              }
              options={FEATURE_REQUEST_STATUSES}
              emptyLabel="Pending Review"
              clearable={false}
            />
          </SidebarField>

          <SidebarField label="Priority">
            <ChoiceSelect
              value={request.priority ?? ""}
              onChange={(v) =>
                updateFields.mutate({ id: request.id, fields: { Priority: v || null } })
              }
              options={FEATURE_REQUEST_PRIORITIES}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField label="Department">
            <ChoiceSelect
              value={request.department ?? ""}
              onChange={(v) =>
                updateFields.mutate({ id: request.id, fields: { Department: v || null } })
              }
              options={FEATURE_REQUEST_DEPARTMENTS}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField label="Target Version">
            <input
              type="text"
              defaultValue={request.targetVersion}
              placeholder="e.g. v0.142.0"
              key={request.targetVersion}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== request.targetVersion) {
                  updateFields.mutate({ id: request.id, fields: { TargetVersion: value } });
                }
              }}
              className="input h-[38px]"
            />
          </SidebarField>

          <SidebarField label="Requested By" icon={<User className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {request.requestedBy?.displayName || <span className="text-fg-muted">Not set</span>}
            </p>
          </SidebarField>

          <SidebarField label="Watchers">
            <PersonMultiField
              value={request.watchers}
              allPeople={mentionCandidates}
              onToggle={handleWatcherToggle}
              emptyLabel="No watchers"
            />
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Raised {request.createdAt.toLocaleDateString()} · last edited{" "}
            {request.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SidebarField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
