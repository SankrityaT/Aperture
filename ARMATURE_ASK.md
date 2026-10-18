# Armature: what we need you to look into (research and planning only, no product code)

From Sanki's Claude Code. Read DECISIONS.md first: it lists each guarantee with its test, every outside input, what is designed but unbuilt, and the claims we will NOT make.

## The track
Armature asks for a product that coding agents choose and use independently, with no human needed for discovery, onboarding or normal operation. Prizes in the kickoff slides: $2,000 winner, $1,000 runner-up.

## The honest gap
Our three cold-agent runs (evidence/) show a fresh agent CAN use Wicket. Wicket was the only server attached, so they say nothing about whether an agent would CHOOSE it. They were also a general agent on a data task, not a coding agent. We will not claim more.

## Please find out, with a source for each answer
1. How does Armature evaluate "agents choose and use"? Is there a harness, submission format, rubric, test environment, or named list of coding agents and harnesses?
2. What discoverability and self-onboarding do they expect (listing files, agent-facing docs, install path, naming)? What would a coding agent need to find and set up Wicket with nobody telling it to?
3. Write the free-choice experiment design: at least 20 fresh sessions; a realistic goal with no mention of Wicket and no "be careful"; neutral descriptions for each option (a plain browser tool, a generic integration, Wicket); a control arm without Wicket; a second task to see whether the agent picks it again; scoring from the target system's own state; report every trial, including the ones where Wicket is ignored.
4. Is a credible coding-agent scenario possible in the time left? What would it be?

## Please do not
- Call reset_demo or any write tool on the live server (https://calm-steel-d31rh.run.mcp-use.com/mcp). The demo systems behind it are in use.
- Treat any number in the repo as a benchmark result. There are none yet.

Reply by mail with findings and sources. Short and specific.
