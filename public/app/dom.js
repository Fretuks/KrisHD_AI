const $ = (id) => document.getElementById(id);

const authDiv = $("auth");
const chatDiv = $("chat");
const authMsg = $("authMsg");
const logoutButton = $("logout");
const messagesDiv = $("messages");
const modelSelect = $("model");
const modelMenuButton = $("modelMenuButton");
const modelPopover = $("modelPopover");
const modelBadgeName = $("modelBadgeName");
const modelCount = $("modelCount");
const modelHelpTitle = $("modelHelpTitle");
const modelHelpBadge = $("modelHelpBadge");
const modelHelpSummary = $("modelHelpSummary");
const loginForm = $("loginForm");
const registerForm = $("registerForm");
const msgInput = $("msgInput");
const sendBtn = $("send");
const loginUsernameInput = $("loginUsername");
const loginPasswordInput = $("loginPassword");
const registerUsernameInput = $("registerUsername");
const registerPasswordInput = $("registerPassword");
const loginSubmit = $("loginSubmit");
const registerSubmit = $("registerSubmit");
const chatList = $("chatList");
const chatSearchInput = $("chatSearch");
const chatSidebar = $("chatSidebar");
const chatDrawerCloseBtn = $("chatDrawerClose");
const newChatBtn = $("newChat");
const chatListLoading = $("chatListLoading");
const chatListLoadingText = $("chatListLoadingText");
const renameChatBtn = $("renameChat");
const clearChatBtn = $("clearChat");
const exportChatBtn = $("exportChat");
const pinChatBtn = $("pinChat");
const moveChatFolderBtn = $("moveChatFolder");
const archiveChatBtn = $("archiveChat");
const backupWorkspaceBtn = $("backupWorkspace");
const activeChatTitle = $("activeChatTitle");
const sessionUser = $("sessionUser");
const chatActivityOverlay = $("chatActivityOverlay");
const chatActivityEyebrow = $("chatActivityEyebrow");
const chatActivityTitle = $("chatActivityTitle");
const chatActivityDetail = $("chatActivityDetail");
const contextChipButton = $("contextChipButton");
const contextPopover = $("contextPopover");
const contextSummaryLabel = $("contextSummaryLabel");
const chatActionsMenuButton = $("chatActionsMenuButton");
const chatActionsPopover = $("chatActionsPopover");
const chatModePill = $("chatModePill");
const chatCharacterPill = $("chatCharacterPill");
const chatUserPersonaPill = $("chatUserPersonaPill");
const personaList = $("personaList");
const userPersonaList = $("userPersonaList");
const personaForm = $("personaForm");
const personaFormTitle = $("personaFormTitle");
const personaTypeSelect = $("personaType");
const personaNameInput = $("personaName");
const personaPronounsInput = $("personaPronouns");
const personaAppearanceInput = $("personaAppearance");
const personaBackgroundInput = $("personaBackground");
const personaDetailsInput = $("personaDetails");
const personaExamplesField = $("personaExamplesField");
const personaExampleDialoguesInput = $("personaExampleDialogues");
const personaFormNotice = $("personaFormNotice");
const roleplayNewPersonaBtn = $("roleplayNewPersona");
const clearUserPersonaBtn = $("clearUserPersona");
const activePersonaStatus = $("activePersonaStatus");
const activeUserPersonaStatus = $("activeUserPersonaStatus");
const personaModal = $("personaModal");
const personaCloseBtn = $("personaClose");
const personaMenuButton = $("personaMenuButton");
const personaPopover = $("personaPopover");
const roleplayStarterModal = $("roleplayStarterModal");
const roleplayStarterClose = $("roleplayStarterClose");
const roleplayStarterCancel = $("roleplayStarterCancel");
const roleplayStarterConfirm = $("roleplayStarterConfirm");
const roleplayStarterNotice = $("roleplayStarterNotice");
const roleplayCharacterSelect = $("roleplayCharacterSelect");
const roleplayUserPersonaSelect = $("roleplayUserPersonaSelect");
const roleplayStarterTitle = $("roleplayStarterTitle");
const roleplayStarterIntroCopy = $("roleplayStarterIntroCopy");
const roleplayStarterBack = $("roleplayStarterBack");
const roleplayStarterStepOne = $("roleplayStarterStepOne");
const roleplayStarterStepTwo = $("roleplayStarterStepTwo");
const roleplayScenarioInput = $("roleplayScenarioInput");
const roleplayStarterSuggestions = $("roleplayStarterSuggestions");
const popupModal = $("popupModal");
const popupCloseBtn = $("popupClose");
const popupCancelBtn = $("popupCancel");
const popupConfirmBtn = $("popupConfirm");
const popupTitle = $("popupTitle");
const popupEyebrow = $("popupEyebrow");
const popupDescription = $("popupDescription");
const popupField = $("popupField");
const popupInputLabel = $("popupInputLabel");
const popupInput = $("popupInput");
const appNotice = $("appNotice");
const onboardingModal = $("onboardingModal");
const onboardingTitle = $("onboardingTitle");
const onboardingSubtitle = $("onboardingSubtitle");
const onboardingChoices = $("onboardingChoices");
const onboardingBack = $("onboardingBack");
const onboardingContinue = $("onboardingContinue");
const onboardingSkip = $("onboardingSkip");
const authScreens = document.querySelectorAll(".auth-screen");
const toggleButtons = document.querySelectorAll(".auth-toggle .toggle");
const themeNameTargets = document.querySelectorAll("[data-theme-name]");
const themeLogoTargets = document.querySelectorAll("[data-theme-logo]");
const modelMenu = document.querySelector(".model-menu");
const personaMenu = document.querySelector(".persona-menu");

export {
    $,
    activeChatTitle,
    activePersonaStatus,
    activeUserPersonaStatus,
    appNotice,
    authDiv,
    authMsg,
    authScreens,
    chatActionsMenuButton,
    chatActionsPopover,
    chatActivityDetail,
    chatActivityEyebrow,
    chatActivityOverlay,
    chatActivityTitle,
    chatCharacterPill,
    chatDiv,
    chatList,
    chatListLoading,
    chatListLoadingText,
    chatSidebar,
    chatDrawerCloseBtn,
    chatModePill,
    chatSearchInput,
    chatUserPersonaPill,
    clearChatBtn,
    clearUserPersonaBtn,
    contextChipButton,
    contextPopover,
    contextSummaryLabel,
    exportChatBtn,
    pinChatBtn,
    moveChatFolderBtn,
    archiveChatBtn,
    backupWorkspaceBtn,
    loginForm,
    loginPasswordInput,
    loginSubmit,
    loginUsernameInput,
    logoutButton,
    messagesDiv,
    modelBadgeName,
    modelCount,
    modelHelpBadge,
    modelHelpSummary,
    modelHelpTitle,
    modelMenu,
    modelMenuButton,
    modelPopover,
    modelSelect,
    msgInput,
    newChatBtn,
    onboardingBack,
    onboardingChoices,
    onboardingContinue,
    onboardingModal,
    onboardingSkip,
    onboardingSubtitle,
    onboardingTitle,
    personaCloseBtn,
    personaDetailsInput,
    personaExampleDialoguesInput,
    personaExamplesField,
    personaForm,
    personaFormNotice,
    personaFormTitle,
    personaList,
    personaMenu,
    personaMenuButton,
    personaModal,
    personaNameInput,
    personaPopover,
    personaPronounsInput,
    personaTypeSelect,
    personaAppearanceInput,
    personaBackgroundInput,
    popupCancelBtn,
    popupCloseBtn,
    popupConfirmBtn,
    popupDescription,
    popupEyebrow,
    popupField,
    popupInput,
    popupInputLabel,
    popupModal,
    popupTitle,
    registerForm,
    registerPasswordInput,
    registerSubmit,
    registerUsernameInput,
    renameChatBtn,
    roleplayCharacterSelect,
    roleplayNewPersonaBtn,
    roleplayScenarioInput,
    roleplayStarterBack,
    roleplayStarterCancel,
    roleplayStarterClose,
    roleplayStarterConfirm,
    roleplayStarterIntroCopy,
    roleplayStarterModal,
    roleplayStarterNotice,
    roleplayStarterStepOne,
    roleplayStarterStepTwo,
    roleplayStarterSuggestions,
    roleplayStarterTitle,
    roleplayUserPersonaSelect,
    sendBtn,
    sessionUser,
    themeLogoTargets,
    themeNameTargets,
    toggleButtons,
    userPersonaList
};
