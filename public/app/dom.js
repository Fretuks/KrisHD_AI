const $ = (id) => document.getElementById(id);

const chatDiv = $("chat");
const messagesDiv = $("messages");
const modelSelect = $("model");
const modelPanel = $("modelPanel");
const modelBadgeName = $("modelBadgeName");
const headerModelName = $("headerModelName");
const headerPersonaName = $("headerPersonaName");
const modelCount = $("modelCount");
const modelHelpTitle = $("modelHelpTitle");
const modelHelpBadge = $("modelHelpBadge");
const modelHelpSummary = $("modelHelpSummary");
const chatTemperatureInput = $("chatTemperature");
const chatContextLengthInput = $("chatContextLength");
const chatResponseLengthInput = $("chatResponseLength");
const chatSystemInstructionInput = $("chatSystemInstruction");
const saveGenerationSettingsBtn = $("saveGenerationSettings");
const chatDrawerPersonaValue = $("chatDrawerPersonaValue");
const msgInput = $("msgInput");
const sendBtn = $("send");
const chatList = $("chatList");
const chatSearchInput = $("chatSearch");
const chatSidebar = $("chatSidebar");
const chatSidebarToggle = $("chatSidebarToggle");
const chatDrawerCloseBtn = $("chatDrawerClose");
const chatDrawerButton = $("chatDrawerButton");
const chatDrawer = $("chatDrawer");
const newChatBtn = $("newChat");
const chatListLoading = $("chatListLoading");
const chatListLoadingText = $("chatListLoadingText");
const renameChatBtn = $("renameChat");
const clearChatBtn = $("clearChat");
const exportChatBtn = $("exportChat");
const pinChatBtn = $("pinChat");
const moveChatFolderBtn = $("moveChatFolder");
const manageChatMemoryBtn = $("manageChatMemory");
const managePersonaStateBtn = $("managePersonaState");
const archiveChatBtn = $("archiveChat");
const backupWorkspaceBtn = $("backupWorkspace");
const importWorkspaceBtn = $("importWorkspace");
const importWorkspaceFileInput = $("importWorkspaceFile");
const activeChatTitle = $("activeChatTitle");
const chatActivityOverlay = $("chatActivityOverlay");
const chatActivityEyebrow = $("chatActivityEyebrow");
const chatActivityTitle = $("chatActivityTitle");
const chatActivityDetail = $("chatActivityDetail");
const chatCharacterPill = $("chatCharacterPill");
const chatUserPersonaPill = $("chatUserPersonaPill");
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
const activeUserPersonaStatus = $("activeUserPersonaStatus");
const personaModal = $("personaModal");
const personaCloseBtn = $("personaClose");
const personaPanel = $("personaPanel");
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
const onboardingModal = $("onboardingModal");
const onboardingTitle = $("onboardingTitle");
const onboardingSubtitle = $("onboardingSubtitle");
const onboardingChoices = $("onboardingChoices");
const onboardingBack = $("onboardingBack");
const onboardingContinue = $("onboardingContinue");
const onboardingSkip = $("onboardingSkip");
const brandNameTargets = document.querySelectorAll("[data-brand-name]");
const brandLogoTargets = document.querySelectorAll("[data-brand-logo]");
const modelSection = document.querySelector(".chat-drawer-section--model");
const personaSection = document.querySelector(".chat-drawer-section--persona");

export {
    $,
    activeChatTitle,
    activeUserPersonaStatus,
    chatActivityDetail,
    chatActivityEyebrow,
    chatActivityOverlay,
    chatActivityTitle,
    chatCharacterPill,
    chatDrawerPersonaValue,
    chatDrawer,
    chatDrawerButton,
    chatDiv,
    chatList,
    chatListLoading,
    chatListLoadingText,
    chatSidebar,
    chatSidebarToggle,
    chatDrawerCloseBtn,
    chatSearchInput,
    chatUserPersonaPill,
    chatTemperatureInput,
    chatContextLengthInput,
    chatResponseLengthInput,
    chatSystemInstructionInput,
    clearChatBtn,
    clearUserPersonaBtn,
    exportChatBtn,
    pinChatBtn,
    moveChatFolderBtn,
    manageChatMemoryBtn,
    managePersonaStateBtn,
    archiveChatBtn,
    backupWorkspaceBtn,
    importWorkspaceBtn,
    importWorkspaceFileInput,
    messagesDiv,
    modelBadgeName,
    headerModelName,
    headerPersonaName,
    modelCount,
    modelHelpBadge,
    modelHelpSummary,
    modelHelpTitle,
    modelPanel,
    modelSection,
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
    personaModal,
    personaNameInput,
    personaPanel,
    personaSection,
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
    saveGenerationSettingsBtn,
    brandLogoTargets,
    brandNameTargets,
    userPersonaList
};
