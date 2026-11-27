const API = {
  getToken() {
    return localStorage.getItem('docflow_token');
  },

  setToken(token) {
    localStorage.setItem('docflow_token', token);
  },

  clearToken() {
    localStorage.removeItem('docflow_token');
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      options.body = JSON.stringify(options.body);
    }

    if (options.body instanceof FormData) {
      delete headers['Content-Type'];
    }

    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      ...options,
      headers
    });

    if (response.status === 401 && !endpoint.startsWith('/api/auth/')) {
      this.clearToken();
      window.dispatchEvent(new Event('auth-unauthorized'));
    }

    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      throw new Error(`Ошибка ответа сервера (${response.status}): ${text.substring(0, 150)}`);
    }

    if (!response.ok) {
      throw new Error(data.error || 'Произошла ошибка при выполнении запроса');
    }

    return data;

  },

  // Auth
  login(email, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
  },

  confirm2FASetup(preAuthToken, code) {
    return this.request('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: { preAuthToken, code }
    });
  },

  verify2FA(preAuthToken, code) {
    return this.request('/api/auth/2fa/verify', {
      method: 'POST',
      body: { preAuthToken, code }
    });
  },

  regenerateBackupCodes(code) {
    return this.request('/api/auth/2fa/regenerate-backup-codes', {
      method: 'POST',
      body: { code }
    });
  },

  getMe() {
    return this.request('/api/auth/me');
  },

  // SSO (DocFlow <-> LabSpace)
  getSsoConfig() {
    return this.request('/api/sso/config');
  },

  getLabspaceSsoUrl() {
    return this.request('/api/sso/labspace?mode=json');
  },

  exchangeSsoCode(code) {
    return this.request('/api/sso/exchange', {
      method: 'POST',
      body: { code }
    });
  },

  completeSsoLink(linkToken) {
    return this.request('/api/sso/link', {
      method: 'POST',
      body: { linkToken }
    });
  },

  // Users
  getUsers() {
    return this.request('/api/users');
  },

  resetUser2FA(id) {
    return this.request(`/api/users/${id}/reset-2fa`, {
      method: 'POST'
    });
  },

  getUserStats() {
    return this.request('/api/users/stats');
  },

  createUser(userData) {
    return this.request('/api/users', {
      method: 'POST',
      body: userData
    });
  },

  updateUser(id, userData) {
    return this.request(`/api/users/${id}`, {
      method: 'PATCH',
      body: userData
    });
  },

  deleteUser(id) {
    return this.request(`/api/users/${id}`, {
      method: 'DELETE'
    });
  },

  getUserHierarchy() {
    return this.request('/api/users/hierarchy');
  },

  getSubordinates() {
    return this.request('/api/users/subordinates');
  },

  // Departments
  getDepartments() {
    return this.request('/api/users/departments');
  },

  createDepartment(data) {
    return this.request('/api/users/departments', {
      method: 'POST',
      body: data
    });
  },

  updateDepartment(id, data) {
    return this.request(`/api/users/departments/${id}`, {
      method: 'PATCH',
      body: data
    });
  },

  deleteDepartment(id) {
    return this.request(`/api/users/departments/${id}`, {
      method: 'DELETE'
    });
  },

  // Mail
  getMailUnreadCount() {
    return this.request('/api/mail/unread-count');
  },

  getMail(folder = 'inbox', search = '') {
    return this.request(`/api/mail?folder=${folder}&search=${encodeURIComponent(search)}`);
  },

  getMailById(id) {
    return this.request(`/api/mail/${id}`);
  },

  getMailSettings() {
    return this.request('/api/mail/settings');
  },

  saveMailSettings(settingsData) {
    return this.request('/api/mail/settings', {
      method: 'POST',
      body: settingsData
    });
  },

  syncMail() {
    return this.request('/api/mail/sync', {
      method: 'POST'
    });
  },

  sendMail(mailData) {
    return this.request('/api/mail/send', {
      method: 'POST',
      body: mailData
    });
  },

  suggestMailRecipients(q = '') {
    return this.request(`/api/mail/recipients/suggest?q=${encodeURIComponent(q)}`);
  },

  deleteMail(id) {
    return this.request(`/api/mail/${id}`, {
      method: 'DELETE'
    });
  },

  toggleMailRead(id, is_read) {
    return this.request(`/api/mail/${id}/read`, {
      method: 'PATCH',
      body: { is_read }
    });
  },

  downloadAttachmentUrl(id) {
    return `/api/mail/attachments/${parseInt(id, 10)}/download`;
  },

  downloadDocumentUrl(id) {
    return `/api/documents/download/${parseInt(id, 10)}`;
  },

  importAttachmentToDocuments(id) {
    return this.request(`/api/mail/attachments/${id}/import`, {
      method: 'POST'
    });
  },


  // Projects
  getProjects() {
    return this.request('/api/projects');
  },

  createProject(projectData) {
    return this.request('/api/projects', {
      method: 'POST',
      body: projectData
    });
  },

  updateProject(id, projectData) {
    return this.request(`/api/projects/${id}`, {
      method: 'PATCH',
      body: projectData
    });
  },

  deleteProject(id) {
    return this.request(`/api/projects/${id}`, {
      method: 'DELETE'
    });
  },

  // Tasks
  getTasks(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/tasks${query ? '?' + query : ''}`);
  },

  createTask(taskData) {
    return this.request('/api/tasks', {
      method: 'POST',
      body: taskData
    });
  },

  updateTask(id, updateData) {
    return this.request(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: updateData
    });
  },

  deleteTask(id) {
    return this.request(`/api/tasks/${id}`, {
      method: 'DELETE'
    });
  },

  // Conferences
  getConferences() {
    return this.request('/api/conferences');
  },

  createConference(confData) {
    return this.request('/api/conferences', {
      method: 'POST',
      body: confData
    });
  },

  updateConference(id, confData) {
    return this.request(`/api/conferences/${id}`, {
      method: 'PATCH',
      body: confData
    });
  },

  deleteConference(id) {
    return this.request(`/api/conferences/${id}`, {
      method: 'DELETE'
    });
  },

  // Calendar
  getCalendarFeed() {
    return this.request('/api/calendar/feed');
  },

  // Documents
  getDocuments() {
    return this.request('/api/documents');
  },

  uploadDocument(formData) {
    return this.request('/api/documents/upload', {
      method: 'POST',
      body: formData
    });
  },

  createDocument(docData) {
    return this.request('/api/documents/create', {
      method: 'POST',
      body: docData
    });
  },

  updateDocument(id, docData) {
    return this.request(`/api/documents/${id}`, {
      method: 'PATCH',
      body: docData
    });
  },

  toggleDocumentPublic(id) {
    return this.request(`/api/documents/${id}/toggle-public`, {
      method: 'POST'
    });
  },

  deleteDocument(id) {
    return this.request(`/api/documents/${id}`, {
      method: 'DELETE'
    });
  },

  // Intelligent Search (Hybrid pgvector ONNX + FTS + pg_trgm across Documents, Materials, Mail Attachments)
  searchDocuments(query, options = {}) {
    const params = new URLSearchParams({
      q: query,
      category: options.category || '',
      limit: options.limit || 12
    });
    if (options.sourceType && options.sourceType !== 'ALL') {
      params.set('source_type', options.sourceType);
    }
    if (options.includeQa) {
      params.set('include_qa', 'true');
    }
    return this.request(`/api/search?${params.toString()}`);
  },

  getSearchStatus() {
    return this.request('/api/search/status');
  },

  reindexDocuments() {
    return this.request('/api/search/reindex', {
      method: 'POST'
    });
  },

  getOnlyofficeConfig(docId) {
    return this.request(`/api/documents/${docId}/onlyoffice-config`);
  },

  saveDocumentNow(docId) {
    return this.request(`/api/documents/${docId}/save-now`, {
      method: 'POST'
    });
  },

  getDocumentPermissions(docId) {
    return this.request(`/api/documents/${docId}/permissions`);
  },

  setDocumentPermission(docId, userId, permissionLevel) {
    return this.request(`/api/documents/${docId}/permissions`, {
      method: 'POST',
      body: { userId, permissionLevel }
    });
  },

  removeDocumentPermission(docId, userId) {
    return this.request(`/api/documents/${docId}/permissions/${userId}`, {
      method: 'DELETE'
    });
  },

  // Roles & Permissions (RBAC)
  getRoles() {
    return this.request('/api/roles');
  },

  createRole(roleData) {
    return this.request('/api/roles', {
      method: 'POST',
      body: roleData
    });
  },

  updateRole(id, roleData) {
    return this.request(`/api/roles/${id}`, {
      method: 'PUT',
      body: roleData
    });
  },

  deleteRole(id) {
    return this.request(`/api/roles/${id}`, {
      method: 'DELETE'
    });
  },

  getPermissions() {
    return this.request('/api/permissions');
  },

  // Document Folders & Bulk Permissions
  bulkGrantDocumentPermissions(docId, data) {
    return this.request(`/api/documents/${docId}/permissions/bulk`, {
      method: 'POST',
      body: data
    });
  },

  getDocumentFolders() {
    return this.request('/api/documents/folders');
  },

  createDocumentFolder(name, parentId = null) {
    return this.request('/api/documents/folders', {
      method: 'POST',
      body: { name, parent_id: parentId }
    });
  },

  updateDocumentFolder(id, data) {
    return this.request(`/api/documents/folders/${id}`, {
      method: 'PATCH',
      body: data
    });
  },

  deleteDocumentFolder(id) {
    return this.request(`/api/documents/folders/${id}`, {
      method: 'DELETE'
    });
  },

  // Conference Formats
  getConferenceFormats() {
    return this.request('/api/conferences/formats');
  },

  createConferenceFormat(name) {
    return this.request('/api/conferences/formats', {
      method: 'POST',
      body: { name }
    });
  },

  // Project Details
  getProjectDetails(id) {
    return this.request(`/api/projects/${id}/details`);
  },

  // Messenger
  getMessengerConversations() {
    return this.request('/api/messenger/conversations');
  },

  getMessengerMessages(query = {}) {
    const q = new URLSearchParams(query).toString();
    return this.request(`/api/messenger/messages${q ? '?' + q : ''}`);
  },

  sendMessengerMessage(data) {
    return this.request('/api/messenger/messages', {
      method: 'POST',
      body: data
    });
  },

  // 3-Level Hierarchy: Directions -> Projects -> Materials
  getDirections() {
    return this.request('/api/directions');
  },

  getDirectionDetails(id) {
    return this.request(`/api/directions/${id}`);
  },

  createDirection(data) {
    return this.request('/api/directions', {
      method: 'POST',
      body: data
    });
  },

  updateDirection(id, data) {
    return this.request(`/api/directions/${id}`, {
      method: 'PUT',
      body: data
    });
  },

  // AI Assistant (Hybrid RAG + Extractive QA + Analytics)
  askAI(question, options = {}) {
    return this.request('/api/ai/ask', {
      method: 'POST',
      body: {
        question,
        ...(options.sourceTypes ? { sourceTypes: options.sourceTypes } : {})
      }
    });
  },

  deleteDirection(id) {
    return this.request(`/api/directions/${id}`, {
      method: 'DELETE'
    });
  },

  createDirectionProject(directionId, data) {
    return this.request(`/api/directions/${directionId}/projects`, {
      method: 'POST',
      body: data
    });
  },

  getProjectMaterials(projectId, params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/projects/${projectId}/materials${q ? '?' + q : ''}`);
  },

  uploadProjectMaterial(projectId, formData) {
    return this.request(`/api/projects/${projectId}/materials`, {
      method: 'POST',
      body: formData
    });
  },

  updateProjectMaterial(id, data) {
    return this.request(`/api/materials/${id}`, {
      method: 'PUT',
      body: data
    });
  },

  deleteProjectMaterial(id) {
    return this.request(`/api/materials/${id}`, {
      method: 'DELETE'
    });
  },

  downloadProjectMaterial(id, filename) {
    const token = this.getToken();
    return fetch(`/api/materials/download/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('Не удалось скачать материал');
      return res.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'material.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });
  },

  getDashboardReports() {
    return this.request('/api/reports/dashboard');
  },

  exportTasksReport() {
    const token = this.getToken();
    return fetch('/api/reports/export/tasks', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('Не удалось экспортировать реестр задач');
      return res.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DocFlow_Reestr_Zadach_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });
  },

  exportSummaryReport() {
    const token = this.getToken();
    return fetch('/api/reports/export/summary', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('Не удалось экспортировать сводку');
      return res.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DocFlow_KPI_Otdelov_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });
  }
};


