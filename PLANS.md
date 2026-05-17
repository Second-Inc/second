# Codex Execution Plans (Merged Repository Rules)

This document defines how to create and maintain an execution plan for work in this repository. An execution plan is a self-contained design and implementation document that a coding agent or a human can follow without relying on prior chat history, hidden assumptions, or external context.

Treat the future reader as a complete beginner who has only the working tree and the single plan file. The plan must carry all of the important context, intent, decisions, steps, validation instructions, and recovery guidance needed to finish the work and verify that it behaves correctly.

## How this document should be used

When asked to plan, do not code. Read the relevant files first, gather the repository context, and then create a new Markdown plan file inside `./plans` using a descriptive name of your choosing.

When writing a plan, follow this file closely and fill in the plan as you learn more. Do not rely on memory. Re-read source files as needed so the plan stays precise.

When implementing from a plan, continue from one phase to the next without asking the user for "next steps" unless you are truly blocked by missing information or a risky ambiguity. Keep the plan updated as work proceeds.

When revising or discussing a plan, record what changed, why it changed, and what evidence or discovery caused the change. A future session must be able to resume from the plan file alone.

When a request has meaningful uncertainty, include exploratory or prototype phases that prove feasibility before committing to the full implementation. These prototypes must still be concrete, observable, and easy to validate.

## Non-negotiable requirements

Every plan must be fully self-contained. In its current form, it must include all knowledge, assumptions, instructions, and repository context needed for a novice to succeed.

Every plan must be a living document. As progress is made, discoveries occur, or design decisions change, the plan must be updated so it continues to reflect reality.

Every plan must guide the reader to a demonstrably working result, not merely to a set of code edits. The document must explain what behavior should exist at the end and how a human can observe that behavior.

Every important term that may be unfamiliar must be explained in plain language. If jargon is used, define it immediately and tie it to the concrete files, commands, modules, or runtime behavior in this repository.

The plan must assume that a later implementation session may have no chat history at all. Because of that, the plan must preserve the full intent of the request, the important constraints, the tradeoffs, and the reasoning behind key choices.

Do not send the reader to external blog posts or documentation as a substitute for explanation. If outside knowledge is required, restate the relevant parts inside the plan in your own words.

If the work depends on an earlier plan and that earlier plan is available in the repository, reference it explicitly. If it is not available, restate all of the relevant context inside the current plan.

When the user asks for planning, do not implement the feature in the same step. Planning mode is for research, technical design, repository analysis, phased rollout design, and validation design only.

When the request contains many details, the plan must capture all of them. Do not compress away important nuance. Do not omit details just because the task appears small.

## Repository-specific planning rules

When asked to plan, create a new `.md` file in `./plans`.

The plan must always include all of the following:

- overall goal
- description of the goal, including sub-goals
- motivation, meaning why the work is being done
- the state before the change
- the state after the change
- how to test and verify the result

The plan must be complete, detailed, and highly technical. It must explain which files are relevant, which code paths or modules matter, and how the implementation approach changes the system.

The plan must begin with high-level motivation and clear before-and-after descriptions, then move into detailed technical design and phased work.

The work must be divided into phases. Each phase must be independently testable by a human through doing, running, or verifying something concrete. Do not rely only on automated tests as the proof for a phase.

Because a future chat may use only the generated plan file as context, the plan must preserve the user's intent as completely as possible. If the original request is nuanced or detail-heavy, include a verbatim copy of the user's planning request in an appendix at the end of the plan.

## Formatting rules

When writing a plan into a Markdown file whose only contents are the plan, write normal Markdown without wrapping the entire file in triple backticks.

If a plan is ever produced inline in chat rather than written to a file, the entire plan should be emitted as one fenced `md` block and should not contain nested triple-backtick blocks.

Use normal Markdown heading syntax. Leave two blank lines after each heading. Use proper ordered and unordered list syntax.

Write narrative sections in prose first. Use lists only when they genuinely make the plan clearer. Checklists are allowed and expected in the `Progress` section.

Commands, short transcripts, code excerpts, and diff fragments should be shown as indented examples when possible so the plan remains easy to copy, edit, and extend.

## Writing guidelines

Anchor the document in observable outcomes. Explain what the user will be able to do after the change that they could not do before, how they should run the system, and what they should see.

Name repository paths explicitly. Use full repository-relative paths. When referring to code, name the exact module, class, component, function, method, command, endpoint, or data structure involved.

Explain how the relevant files fit together. If the work spans several areas, include a short orientation section so a novice can navigate the codebase with confidence.

When commands are required, include the working directory and the exact command line to run. Describe the expected result and how to recognize success or failure.

Write steps so they are safe and repeatable. If a step can be retried harmlessly, say so. If a step is risky, destructive, or only partly reversible, provide rollback or recovery guidance.

Validation is mandatory. Plans must explain how to run the project, how to exercise the feature, what to observe, which tests to run if relevant, and what outputs indicate success.

If a change is mostly internal, the plan must still describe how to demonstrate its effect. That may include a failing-before and passing-after scenario, a CLI flow, a request and response example, logs, or a manual walkthrough.

Use evidence. If a discovery or validation depends on specific output, capture a short representative transcript, diff excerpt, or log snippet.

Resolve ambiguity inside the plan whenever possible. Do not push key design decisions onto the future implementer unless there is a strong reason.

Prefer additive and testable changes. When migrations, parallel implementations, or temporary compatibility layers are needed, explain how both old and new behavior will be validated and how the old path will be retired safely.

For large unknowns, break out feasibility spikes or prototype phases. Each prototype must state what question it answers, how to run it, and what result would justify proceeding or changing direction.

## Required sections in every generated plan

Every generated plan file in `./plans` must contain all of the following sections, in this order unless there is a strong reason to reorder them:

## Title

Use a short, action-oriented title.

## Living Document Note

State that the plan is a living document and must be updated throughout implementation. Mention that it must stay consistent with this file at `.agent/PLANS.md`.

## Overall Goal

State the top-level outcome in plain language.

## Goal Description / Sub-goals

Break the goal into the concrete sub-goals that must be completed for the work to be considered done.

## Motivation

Explain why this work is being done, from the user or product perspective.

## State Before

Describe the relevant current behavior, architecture, limitations, missing functionality, or existing risks before the change.

## State After

Describe the expected behavior, architecture, and user-visible result after the change.

## Context and Orientation

Describe the relevant repository context for a novice reader. Explain the key modules, services, entry points, and data flow involved in this task.

## Relevant Files and Code Areas

List the important files and code areas by repository-relative path, and explain why each one matters.

## Assumptions and Constraints

State every important assumption, dependency, environment expectation, and constraint that shapes the plan.

## Progress

Use a checklist with timestamps. This section must reflect the real state of the work at every stopping point, including partially completed work split into completed and remaining pieces.

## Surprises & Discoveries

Record unexpected findings, edge cases, library behavior, hidden coupling, performance concerns, or bugs discovered during research or implementation, with short supporting evidence where possible.

## Decision Log

Record each important decision, the rationale for it, and the date and author.

## Plan of Work

Provide the detailed technical design in prose. Explain the sequence of changes, which files and code paths will be touched, what will be added or changed, and how the design hangs together.

## Phased Implementation Plan

Break the work into explicit phases. Each phase must include:

- purpose of the phase
- files and code areas touched
- exact implementation scope
- why the phase is ordered here
- what a human should do, run, or inspect to verify the phase
- what should be observable if the phase is successful
- any rollback, retry, or safety notes specific to the phase

## Concrete Steps and Commands

Provide the exact commands to run, where to run them, and what outputs or side effects to expect.

## Validation and Acceptance

Describe the full validation approach. Include both automated validation if relevant and manual user verification. Phrase acceptance in terms of observable behavior.

## Idempotence and Recovery

Explain how the steps can be repeated safely and how to recover from partial failure, bad intermediate state, or a mistaken rollout.

## Interfaces and Dependencies

Name the libraries, services, modules, interfaces, contracts, and types that must exist or change by the end of the work. Be specific.

## Artifacts and Notes

Include concise supporting examples such as short transcripts, snippets, mini-diffs, or example requests and responses when they help prove understanding or expected behavior.

## Outcomes & Retrospective

At major milestones or completion, summarize what was achieved, what remains, and what was learned.

## Change Notes

When the plan is revised, append a short note describing what changed and why.

## Captured User Intent (Verbatim)

When the request contains important nuance, paste the original planning request verbatim so a future session cannot accidentally lose intent.

## Expectations for phased plans

Phases are not administrative padding. They should tell a readable story of how the system moves from the current state to the final state.

Each phase must produce a meaningful intermediate state that a human can verify directly.

Each phase should be small enough to reason about, but not so small that the plan turns into noise.

If a phase depends on a prototype, explicitly label the prototype as such and state the promotion criteria for turning it into production work.

If a request is simple but detail-heavy, still preserve the detail. The number of phases can remain small, but the descriptions must stay precise.

## Suggested skeleton for new plan files

Use the following structure when creating a new plan in `./plans/<descriptive-name>.md`:

    # <Short action-oriented title>


    This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with `.agent/PLANS.md`.


    ## Overall Goal


    <Plain-language statement of the final outcome.>


    ## Goal Description / Sub-goals


    <Sub-goals required to complete the work.>


    ## Motivation


    <Why this matters. Focus on the user, product, or engineering outcome.>


    ## State Before


    <What exists now, what is missing, and what currently hurts or blocks the goal.>


    ## State After


    <What will exist after the change, including user-visible and architectural effects.>


    ## Context and Orientation


    <Explain the relevant repository areas for a newcomer.>


    ## Relevant Files and Code Areas


    - `path/to/file`: <why it matters>
    - `path/to/another/file`: <why it matters>


    ## Assumptions and Constraints


    <Environment assumptions, dependencies, risks, limitations, non-goals.>


    ## Progress


    - [ ] (YYYY-MM-DD HH:MMZ) Initial research completed and plan drafted.
    - [ ] Example partially completed task (completed: ...; remaining: ...).


    ## Surprises & Discoveries


    - Observation: <unexpected finding>
      Evidence: <short proof, transcript, or note>


    ## Decision Log


    - Decision: <what was decided>
      Rationale: <why>
      Date/Author: <timestamp / author>


    ## Plan of Work


    <Detailed technical design in prose. Explain the exact files, code paths, edits, and interactions.>


    ## Phased Implementation Plan


    ### Phase 1: <name>


    <Purpose, scope, relevant files, approach, and why this phase comes first.>


    Manual verification:

    - <What the human should run, do, inspect, or click>
    - <What should be visible or true afterward>


    Acceptance signals:

    - <Observable proof this phase worked>


    Safety / recovery:

    - <Rollback or retry guidance if this phase goes wrong>


    ### Phase 2: <name>


    <Repeat the same structure.>


    ## Concrete Steps and Commands


    Working directory: `<repo-root-or-subdir>`

        <exact command>
        <expected output snippet>


    ## Validation and Acceptance


    <Automated checks if relevant, plus the manual flow a human will use to verify the phase or final result.>


    ## Idempotence and Recovery


    <How to rerun safely, clean up, or recover from a partial state.>


    ## Interfaces and Dependencies


    <Specific modules, contracts, APIs, libraries, and signatures affected.>


    ## Artifacts and Notes


        <short transcript, request/response sample, or diff excerpt>


    ## Outcomes & Retrospective


    <Fill in during implementation and at completion.>


    ## Change Notes


    - <what changed in this plan and why>


    ## Captured User Intent (Verbatim)


    <Paste the original planning request verbatim when preserving exact wording matters.>

## Recommended AGENTS.md hook

Keep `AGENTS.md` short. Use it to tell Codex when to use this planning system, not to restate the whole planning rubric.

Recommended snippet:

    ## Plans

    When asked to plan, do not code. Read the relevant files first and create a detailed execution plan in `./plans/<descriptive-name>.md` following `PLANS.md`.

    For planning requests, the plan must preserve the full user intent, include motivation, before/after state, relevant files, phased work, and concrete manual verification for each phase.

## Original user planning rules captured verbatim

The following text is preserved verbatim because the repository-specific planning behavior should not lose any instruction the user explicitly cared about:

    # About plans
    - When asked to plan, your plan file will be an .md file which will go into the ./plans folder
    - Plan files will always include: overall goal, description of the goal (sub goal), motiviation (why are we doing this), the state before, the state that should be after, how to test... Pay attention to my request and make sure that no details are missed.
    When asked to plan, you do not code. You will just read all of the relevant files, and you will create a complete, detailed, extremely detailed technical design and phase with tasks on how to approach and implement that. The requests might not be too big, but they do contain a lot of details usually, so you need to get it right and explain which files are relevant, which parts of the code, and how the approach is shifting.
    So, include a high-level motivation and before-and-after expressions, and then drive into details. CRUCIAL: Also, do not miss any detail from what I explained here because we will then later create a completely new chat and session, and the only context will be that document. It should include all of my intents and even at the end, you can include this entire prompt, verbal team, including even
    this what I'm saying right now. Create the plan in a new markdown file in this folder, with a name of your choosing.
    I want you to make sure that the plan is divided into phases - specifically each phase should be testable. Not using tests, 
    but by me actually doing / running / verifying something.

    Why am I telling you all of this?  because from our past experience and interactions, I know how great of a coder you are, how great of an engineer you are, and how great of a system architect and
    designer you are. I just completely and a hundred percent trust you.
    I have seen your work previously. You have tackled much greater and much more complex system design, system architecture, and coding tasks, and you have done them beautifully well. This is I fully and
    a 100% respect you and trust you.
    Thank you so much! I really appreciate it.
