/* eslint-disable */
// ── Page: CrewChatPage ──
// Three-column layout mirroring ChatPage, but driven by a crew config.
// Sub-agent tokens/thinking/tool events surface in the middle column via
// useCrewChatState's namespaced tags (subagent-token:<name> etc).

import { html } from '../utils.js';
import { useCrewChatState } from './crew-chat/useCrewChatState.js';
import { CrewChatConfigPanel } from './crew-chat/CrewChatConfigPanel.js';
import { ChatMessagePanel } from './chat/ChatMessagePanel.js';
import { ChatRightPanel } from './chat/ChatRightPanel.js';

export function CrewChatPage() {
  var chat = useCrewChatState();

  return html`
    <div class="chat-page">
      <div class="page-header">
        <div class="page-title">Chat with Crew</div>
        <div class="page-desc">Start a new crew conversation or resume an existing one.</div>
      </div>

      <div class="chat-layout">
        <${CrewChatConfigPanel}
          crews=${chat.crews}
          selectedCrew=${chat.selectedCrew}
          setSelectedCrew=${chat.setSelectedCrew}
          workspacePath=${chat.workspacePath}
          setWorkspacePath=${chat.setWorkspacePath}
          sessionId=${chat.sessionId}
          resumeSessionId=${chat.resumeSessionId}
          setResumeSessionId=${chat.setResumeSessionId}
          configOpen=${chat.configOpen}
          setConfigOpen=${chat.setConfigOpen}
          advOpen=${chat.advOpen}
          setAdvOpen=${chat.setAdvOpen}
          askRequestId=${chat.askRequestId}
          setAskRequestId=${chat.setAskRequestId}
          askResponse=${chat.askResponse}
          setAskResponse=${chat.setAskResponse}
          sendAskResponse=${chat.sendAskResponse}
          cfgSandbox=${chat.cfgSandbox}
          setCfgSandbox=${chat.setCfgSandbox}
          cfgSession=${chat.cfgSession}
          setCfgSession=${chat.setCfgSession}
          cfgTodolist=${chat.cfgTodolist}
          setCfgTodolist=${chat.setCfgTodolist}
          cfgCommands=${chat.cfgCommands}
          setCfgCommands=${chat.setCfgCommands}
          cfgBShell=${chat.cfgBShell}
          setCfgBShell=${chat.setCfgBShell}
          cfgBWebSearch=${chat.cfgBWebSearch}
          setCfgBWebSearch=${chat.setCfgBWebSearch}
          cfgBWebFetch=${chat.cfgBWebFetch}
          setCfgBWebFetch=${chat.setCfgBWebFetch}
          cfgBPython=${chat.cfgBPython}
          setCfgBPython=${chat.setCfgBPython}
          cfgBGit=${chat.cfgBGit}
          setCfgBGit=${chat.setCfgBGit}
          cfgBFileRead=${chat.cfgBFileRead}
          setCfgBFileRead=${chat.setCfgBFileRead}
          cfgBFileWrite=${chat.cfgBFileWrite}
          setCfgBFileWrite=${chat.setCfgBFileWrite}
          cfgBFileEdit=${chat.cfgBFileEdit}
          setCfgBFileEdit=${chat.setCfgBFileEdit}
          cfgBGlob=${chat.cfgBGlob}
          setCfgBGlob=${chat.setCfgBGlob}
          cfgBGrep=${chat.cfgBGrep}
          setCfgBGrep=${chat.setCfgBGrep}
          cfgA2ui=${chat.cfgA2ui}
          setCfgA2ui=${chat.setCfgA2ui}
          cfgSkillDirs=${chat.cfgSkillDirs}
          setCfgSkillDirs=${chat.setCfgSkillDirs}
          cfgMcpPaths=${chat.cfgMcpPaths}
          setCfgMcpPaths=${chat.setCfgMcpPaths}
        />

        <${ChatMessagePanel}
          sessionId=${chat.sessionId}
          chatLines=${chat.chatLines}
          message=${chat.message}
          setMessage=${chat.setMessage}
          sendMessage=${chat.sendMessage}
          stopChat=${chat.stopChat}
          streaming=${chat.streaming}
          msgThinking=${chat.msgThinking}
          setMsgThinking=${chat.setMsgThinking}
          msgModel=${chat.msgModel}
          setMsgModel=${chat.setMsgModel}
          modelInfo=${chat.modelInfo}
          formatTokens=${chat.formatTokens}
          fetchModelInfo=${chat.fetchModelInfo}
          messagesEndRef=${chat.messagesEndRef}
          setChatLines=${chat.setChatLines}
          setCockpitEvents=${chat.setCockpitEvents}
          setSessionId=${chat.setSessionId}
          setResumeSessionId=${chat.setResumeSessionId}
        />

        <${ChatRightPanel}
          sessionId=${chat.sessionId}
          rightTab=${chat.rightTab}
          setRightTab=${chat.setRightTab}
          cockpitEvents=${chat.cockpitEvents}
          diagnosticsData=${chat.diagnosticsData}
          rightFileTree=${chat.rightFileTree}
          rightFilePath=${chat.rightFilePath}
          rightFileContent=${chat.rightFileContent}
          rightSaveStatus=${chat.rightSaveStatus}
          openRightFile=${chat.openRightFile}
          saveRightFile=${chat.saveRightFile}
          setRightFileContent=${chat.setRightFileContent}
          evtLogRef=${chat.evtLogRef}
        />
      </div>
    </div>
  `;
}
