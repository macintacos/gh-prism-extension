#!/usr/bin/env bash
# Creates a public sandbox repository under an organization, with two teams, a
# CODEOWNERS on main that covers every ownership case, and three open PRs whose
# bodies list the code owners gh-prism should show. All content is fake.
# Public and org-owned because team owners only resolve in an organization's
# repository, and GitHub Free applies code owners only to public ones.
# Needs the admin:org scope (gh auth refresh -s admin:org) to create the teams.
# Resumable per PR: the repo, teams, main, and each PR are skipped when they
# already exist, and an existing PR's body is refreshed to the current text.
#
# Usage: scripts/create-codeowners-sandbox.sh <org>/<repo>
set -euo pipefail

readonly repo="${1:?usage: scripts/create-codeowners-sandbox.sh <org>/<repo>}"
readonly org=${repo%/*}
me=$(gh api user --jq .login)
readonly me

commit() {
	git add -A
	git commit -q -m "$1"
}

pr_exists() {
	gh pr view "$1" -R "$repo" >/dev/null 2>&1
}

# Bodies write @ORG and @ME so their quoted heredocs keep backticks literal.
fill() {
	local body=${1//@ORG/@$org}
	printf '%s' "${body//@ME/@$me}"
}

# REST rather than gh pr edit, which depends on gh's GraphQL project lookups.
refresh_pr() {
	local number
	number=$(gh pr view "$1" -R "$repo" --json number --jq .number)
	gh api -X PATCH "repos/$repo/pulls/$number" -f body="$(fill "$2")" >/dev/null
}

open_pr() {
	git push -q -u --force-with-lease origin "$1"
	gh pr create -R "$repo" --base main --head "$1" --title "$2" --body "$(fill "$3")"
}

module_file() {
	awk -v n="$1" 'BEGIN {
		printf "export const id = \"module-%s\";\n\n", n
		for (i = 1; i <= 12; i++) {
			printf "export function step%d(input: number): number {\n", i
			printf "  return input + %d;\n}\n\n", i
		}
		printf "export const steps = 12;\n"
	}'
}

team_exists() {
	gh api "orgs/$org/teams/$1" >/dev/null 2>&1
}

setup_teams() {
	local team
	for team in frontend platform; do
		# A code-owner team must be visible (closed; the API defaults to secret) and have write access.
		if ! team_exists "$team"; then
			gh api -X POST "orgs/$org/teams" -f name="$team" -f privacy=closed >/dev/null
		fi
		gh api -X PUT "orgs/$org/teams/$team/repos/$repo" -f permission=push >/dev/null
	done
	# GitHub makes a team's creator its maintainer; platform stays memberless so some files are owned, but not by you.
	if gh api "orgs/$org/teams/platform/memberships/$me" >/dev/null 2>&1; then
		gh api -X DELETE "orgs/$org/teams/platform/memberships/$me" >/dev/null
	fi
}

seed_main() {
	git ls-remote --exit-code origin main >/dev/null 2>&1 && return
	git checkout -q -B main
	mkdir -p .github web docs api/generated infra

	cat >.github/CODEOWNERS <<EOF
# Fake ownership for gh-prism's code-owners checks. The last matching rule wins.
/web/            @${org}/frontend
/docs/           @${me}
/api/            @${org}/platform @${me}
/infra/          @${org}/platform
/api/generated/  @${org}/frontend
EOF

	cat >README.md <<'EOF'
# codeowners-fixture

A fake project that exists only to stage code-owners scenarios.
EOF

	cat >web/app.ts <<'EOF'
export function start(): string {
  return "app started";
}
EOF

	cat >web/button.ts <<'EOF'
export function label(text: string): string {
  return `[${text}]`;
}
EOF

	cat >docs/guide.md <<'EOF'
# Guide

Start the app, then open the dashboard.
EOF

	cat >api/routes.ts <<'EOF'
export const routes = ["/health", "/items"];
EOF

	cat >api/generated/client.ts <<'EOF'
export function fetchItems(): string[] {
  return [];
}
EOF

	cat >infra/deploy.yml <<'EOF'
service: fixture
replicas: 1
EOF

	commit "Seed the code-owners fixture"
	git push -q -u origin main
}

every_owner_pr() {
	local body
	body=$(
		cat <<'EOF'
Expected code owners, from main's CODEOWNERS. The shield lists these owners in this order.

- `web/app.ts`: `@ORG/frontend`.
- `docs/guide.md`: `@ME`.
- `api/routes.ts`: `@ORG/platform`, `@ME`.
- `api/generated/client.ts`: `@ORG/frontend`. The later `/api/generated/` rule overrides `/api/`.
- `infra/deploy.yml`: `@ORG/platform`.
- `README.md`: no owner, so no shield.

Requested: `@ORG/frontend`, whose only member is you, and `@ORG/platform`, which has no members.

"Only files owned by…" lists:

- Me: `web/app.ts`, `docs/guide.md`, `api/routes.ts`, `api/generated/client.ts`.
- `@ORG/frontend`: `web/app.ts`, `api/generated/client.ts`.
- `@ORG/platform`: `api/routes.ts`, `infra/deploy.yml`.
EOF
	)
	if pr_exists every-owner; then
		refresh_pr every-owner "$body"
		return
	fi
	git checkout -q -B every-owner main
	echo 'export const version = "1.1";' >>web/app.ts
	echo 'Stop the app with Ctrl-C.' >>docs/guide.md
	echo 'export const health = routes[0];' >>api/routes.ts
	echo 'export const retries = 2;' >>api/generated/client.ts
	echo 'region: test-1' >>infra/deploy.yml
	echo 'Nothing here is real.' >>README.md
	commit "Touch every ownership case"
	open_pr every-owner "Touch every ownership case" "$body" >/dev/null
}

codeowners_edit_pr() {
	local body
	body=$(
		cat <<'EOF'
This PR edits CODEOWNERS, but owners come from main's copy, so its new `/notes/` rule doesn't apply yet.

- `.github/CODEOWNERS`: no owner.
- `notes/todo.md`: no owner. This PR's own rule would give it `@ORG/frontend`.
- `docs/guide.md`: `@ME`.
- `infra/deploy.yml`: `@ORG/platform`.

Requested: `@ORG/platform`.

"Only files owned by…" lists:

- Me: `docs/guide.md`.
- `@ORG/platform`: `infra/deploy.yml`.

Here Me and an owner filter set to `@ME` list the same files, since no file is owned through `@ORG/frontend`.
EOF
	)
	if pr_exists codeowners-edit; then
		refresh_pr codeowners-edit "$body"
		return
	fi
	git checkout -q -B codeowners-edit main
	printf '/notes/          @%s/frontend\n' "$org" >>.github/CODEOWNERS
	mkdir -p notes
	printf '# To do\n\n- Write the release notes.\n' >notes/todo.md
	echo 'See notes/ for open tasks.' >>docs/guide.md
	echo 'replicas_max: 2' >>infra/deploy.yml
	commit "Give notes/ an owner"
	open_pr codeowners-edit "Give notes/ an owner" "$body" >/dev/null
}

large_pr() {
	local body
	body=$(
		cat <<'EOF'
Expected code owners, from main's CODEOWNERS. 152 files, so GitHub loads diffs as you scroll, and `web/src/catalog.ts` (+3,000) starts behind Load diff.

- `web/src/modules/module-001.ts` … `module-050.ts` (50 files): `@ORG/frontend`.
- `web/src/catalog.ts`: `@ORG/frontend`.
- `api/modules/module-051.ts` … `module-100.ts` (50 files): `@ORG/platform`, `@ME`.
- `infra/modules/module-101.ts` … `module-150.ts` (50 files): `@ORG/platform`.
- `CHANGELOG.md`: no owner.

Requested: `@ORG/frontend` and `@ORG/platform`.

"Only files owned by…" lists:

- Me: the 50 `web/src/modules/` files, `web/src/catalog.ts`, and the 50 `api/modules/` files.
- `@ORG/frontend`: the 50 `web/src/modules/` files and `web/src/catalog.ts`.
- `@ORG/platform`: the 50 `api/modules/` files and the 50 `infra/modules/` files.
EOF
	)
	if pr_exists large-change; then
		refresh_pr large-change "$body"
		return
	fi
	git checkout -q -B large-change main
	mkdir -p web/src/modules api/modules infra/modules
	local id
	for id in $(seq -f '%03g' 1 50); do module_file "$id" >"web/src/modules/module-$id.ts"; done
	for id in $(seq -f '%03g' 51 100); do module_file "$id" >"api/modules/module-$id.ts"; done
	for id in $(seq -f '%03g' 101 150); do module_file "$id" >"infra/modules/module-$id.ts"; done
	{
		echo 'export const catalog = ['
		# 3,000 lines with the brackets.
		seq 1 2998 | awk '{ printf "  { id: %d, name: \"item-%d\" },\n", $1, $1 }'
		echo '];'
	} >web/src/catalog.ts
	printf '# Changelog\n\n- Add the generated module catalog.\n' >CHANGELOG.md
	commit "Add the generated module catalog"
	open_pr large-change "Add the generated module catalog" "$body" >/dev/null
}

gh api "orgs/$org" >/dev/null # fails unless $org is an organization
gh repo view "$repo" >/dev/null 2>&1 ||
	gh repo create "$repo" --public --description "Fake fixture repo for gh-prism's code-owners checks"
setup_teams

clone_dir=$(mktemp -d)
trap 'rm -rf -- "$clone_dir"' EXIT
gh repo clone "$repo" "$clone_dir" -- -q
cd "$clone_dir"
git config user.name "$me"
user_id=$(gh api user --jq .id)
git config user.email "$user_id+$me@users.noreply.github.com"

# Call order fixes the PR numbers (#1 every-owner, #2 codeowners-edit, #3 large-change) that hand checks cite.
seed_main
every_owner_pr
codeowners_edit_pr
large_pr

for branch in every-owner codeowners-edit large-change; do
	gh pr view "$branch" -R "$repo" --json url --jq .url
done
