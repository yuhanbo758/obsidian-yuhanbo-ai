const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    openrouterApiKey: '',
    geminiApiKey: '',
    deepseekApiKey: '',
    defaultModel: 'google/gemini-flash-1.5',
    templatePath: '',
    customModels: [] // 存储用户自定义的模型
};

// 修改默认模型列表
const BUILT_IN_MODELS = [
    {value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', provider: 'openrouter'},
    {value: 'openai/chatgpt-4o-latest', label: 'GPT-4O Latest', provider: 'openrouter'},
    {value: 'openai/gpt-4o-mini', label: 'GPT-4O Mini', provider: 'openrouter'},
    {value: 'google/gemini-flash-1.5', label: 'Gemini Flash', provider: 'openrouter'},
    {value: 'google/gemini-pro-1.5', label: 'Gemini Pro', provider: 'openrouter'},
    {value: 'openai/gpt-3.5-turbo', label: 'GPT-3.5 Turbo', provider: 'openrouter'},
    {value: 'deepseek-chat', label: 'deepseek-chat', provider: 'deepseek'},
];

class OpenRouterPlugin extends obsidian.Plugin {
    settings;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'open-openrouter-prompt',
            name: '调用AI生成并替换内容',
            editorCallback: (editor) => {
                const selectedText = editor.getSelection();
                if (selectedText) {
                    new PromptModal(this.app, editor, this.settings, 'replace').open();
                } else {
                    new obsidian.Notice('请先选择文本');
                }
            }
        });

        this.addCommand({
            id: 'open-openrouter-prompt-insert',
            name: '调用AI生成并插入内容',
            editorCallback: (editor) => {
                const selectedText = editor.getSelection();
                if (selectedText) {
                    new PromptModal(this.app, editor, this.settings, 'insert').open();
                } else {
                    new obsidian.Notice('请先选择文本');
                }
            }
        });

        this.addSettingTab(new OpenRouterSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async generateWithGemini(prompt, modelName) {
        // 直接使用模型名称，不需要分割
        const apiEndpoint = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${this.settings.geminiApiKey}`;
        
        try {
            console.log('Calling Gemini API with model:', modelName); // 添加调试日志
            
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Gemini API error response:', errorData); // 添加错误日志
                throw new Error(`Gemini API 错误: ${errorData.error?.message || '未知错误'}`);
            }

            const data = await response.json();
            console.log('Gemini API response:', data); // 添加响应日志
            
            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                throw new Error('Gemini API 返回了意外的响应格式');
            }

            const generatedText = data.candidates[0].content.parts[0]?.text;
            if (!generatedText) {
                throw new Error('Gemini API 未返回生成的文本');
            }

            return {
                choices: [{
                    message: {
                        content: generatedText
                    }
                }]
            };
        } catch (error) {
            console.error('Gemini API 错误:', error);
            throw error;
        }
    }

    async generateWithDeepseek(prompt, model) {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.settings.deepseekApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt}
                ],
                stream: false
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`DeepSeek API 错误: ${errorData.error?.message || '未知错误'}`);
        }
        
        return await response.json();
    }
}

class PromptModal extends obsidian.Modal {
    constructor(app, editor, settings, mode = 'replace') {
        super(app);
        this.app = app;
        this.editor = editor;
        this.settings = settings;
        this.promptInput = '';
        this.selectedModel = settings.defaultModel;
        this.mode = mode;
        this.templates = [];
        this.plugin = app.plugins.plugins['obsidian-openrouter'];
    }

    async loadTemplates() {
        this.templates = [];
        if (!this.settings.templatePath) return;

        const templateFolder = this.app.vault.getAbstractFileByPath(this.settings.templatePath);
        if (!templateFolder || !(templateFolder instanceof obsidian.TFolder)) return;

        const files = templateFolder.children;
        for (const file of files) {
            if (file instanceof obsidian.TFile && file.extension === 'md') {
                const content = await this.app.vault.read(file);
                this.templates.push({
                    name: file.basename,
                    content: content
                });
            }
        }
    }

    async onOpen() {
        await this.loadTemplates();
        const {contentEl} = this;
        contentEl.createEl('h3', {text: '输入提示词'});

        // 添加模型选择下拉框
        const modelContainer = contentEl.createDiv();
        modelContainer.createEl('label', {text: '选择模型：'}).style.marginRight = '10px';
        const modelSelect = modelContainer.createEl('select');
        
        // 合并内置模型和自定义模型
        const allModels = [...BUILT_IN_MODELS, ...this.settings.customModels];
        
        // 添加所有模型选项
        allModels.forEach(model => {
            const option = modelSelect.createEl('option', {
                value: model.value,
                text: `${model.label} (${model.provider})`  // 显示提供商信息
            });
        });

        modelSelect.value = this.selectedModel;
        modelSelect.addEventListener('change', (e) => {
            this.selectedModel = e.target.value;
        });

        modelContainer.style.marginBottom = '1em';

        // 添加模板搜索功能
        if (this.templates.length > 0) {
            const templateContainer = contentEl.createDiv();
            templateContainer.createEl('label', {text: '搜索模板：'}).style.marginRight = '10px';
            
            // 创建搜索输入框
            const searchInput = templateContainer.createEl('input', {
                type: 'text',
                placeholder: '输入关键词搜索模板...'
            });

            // 创建模板列表容器
            const templateListContainer = contentEl.createDiv({
                cls: 'template-list-container'
            });
            templateListContainer.style.display = 'none'; // 初始隐藏
            
            // 创建模板列表
            const templateList = templateListContainer.createEl('ul', {
                cls: 'template-list'
            });

            // 处理搜索输入
            searchInput.addEventListener('input', () => {
                const searchTerm = searchInput.value.toLowerCase();
                templateList.empty();
                
                if (searchTerm) {
                    const matchedTemplates = this.templates.filter(template => 
                        template.name.toLowerCase().includes(searchTerm) ||
                        template.content.toLowerCase().includes(searchTerm)
                    );

                    if (matchedTemplates.length > 0) {
                        templateListContainer.style.display = 'block';
                        matchedTemplates.forEach(template => {
                            const li = templateList.createEl('li', {
                                cls: 'template-list-item'
                            });
                            
                            const templateTitle = li.createEl('div', {
                                text: template.name,
                                cls: 'template-title'
                            });
                            
                            // 显示模板预览
                            const preview = li.createEl('div', {
                                text: template.content.slice(0, 100) + (template.content.length > 100 ? '...' : ''),
                                cls: 'template-preview'
                            });

                            li.addEventListener('click', () => {
                                input.value = template.content;
                                templateListContainer.style.display = 'none';
                                searchInput.value = '';
                                input.focus();
                            });
                        });
                    } else {
                        templateListContainer.style.display = 'none';
                    }
                } else {
                    templateListContainer.style.display = 'none';
                }
            });

            // 点击外部关闭模板列表
            document.addEventListener('click', (e) => {
                if (!templateListContainer.contains(e.target) && 
                    !searchInput.contains(e.target)) {
                    templateListContainer.style.display = 'none';
                }
            });

            templateContainer.style.marginBottom = '1em';
        }

        // 提示词输入框
        const inputContainer = contentEl.createDiv();
        const input = inputContainer.createEl('textarea', {
            placeholder: '请输入提示词...\n按回车发送\nCtrl+Enter 换行'
        });
        
        // 设置文本框样式
        input.style.width = '100%';
        input.style.height = '100px';
        input.style.marginBottom = '1em';
        input.style.padding = '8px';
        input.style.resize = 'vertical';

        // 自动聚焦到输入框
        setTimeout(() => {
            input.focus();
        }, 0);

        // 添加键盘事件监听
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+Enter 或 Cmd+Enter (Mac) 插入换行
                    return; // 让浏览器处理默认的换行行为
                } else {
                    // 普通回车发送
                    e.preventDefault(); // 阻止默认的换行行为
                    this.promptInput = input.value;
                    this.close();  // 先关闭对话框
                    await this.generateContent();  // 然后生成内容
                }
            }
        });

        // 按钮容器
        const buttonContainer = contentEl.createDiv({cls: 'prompt-modal-buttons'});
        
        // 取消按钮
        const cancelButton = buttonContainer.createEl('button', {text: '取消'});
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        // 提交按钮
        const submitButton = buttonContainer.createEl('button', {
            text: '提交',
            cls: 'mod-cta'
        });
        
        submitButton.addEventListener('click', async () => {
            this.promptInput = input.value;
            this.close();  // 先关闭对话框
            await this.generateContent();  // 然后生成内容
        });
    }

    async generateContent() {
        const selectedText = this.editor.getSelection();
        const cursor = this.editor.getCursor('to');
        let loadingNotice = null;
        
        try {
            loadingNotice = new obsidian.Notice('正在生成内容...', 0);
            
            let generatedText = '';
            const selectedModelInfo = [...BUILT_IN_MODELS, ...this.settings.customModels]
                .find(m => m.value === this.selectedModel);

            if (!selectedModelInfo) {
                throw new Error('未找到选择的模型');
            }

            const prompt = `${this.promptInput}\n\n上下文：${selectedText}`;

            switch (selectedModelInfo.provider) {
                case 'gemini':
                    if (!this.settings.geminiApiKey) {
                        throw new Error('请先设置 Gemini API Key');
                    }
                    console.log('Using Gemini model:', selectedModelInfo.value); // 添加调试日志
                    const geminiResponse = await this.plugin.generateWithGemini(prompt, selectedModelInfo.value);
                    generatedText = geminiResponse.choices[0].message.content;
                    break;

                case 'deepseek':
                    if (!this.settings.deepseekApiKey) {
                        throw new Error('请先设置 Deepseek API Key');
                    }
                    const deepseekResponse = await this.plugin.generateWithDeepseek(prompt, selectedModelInfo.value);
                    generatedText = deepseekResponse.choices[0].message.content;
                    break;

                case 'openrouter':
                default:
                    if (!this.settings.openrouterApiKey) {
                        throw new Error('请先设置 OpenRouter API Key');
                    }
                    const openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.settings.openrouterApiKey}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': 'http://localhost:8080',
                            'X-Title': 'Obsidian OpenRouter Plugin'
                        },
                        body: JSON.stringify({
                            model: this.selectedModel,
                            messages: [{
                                role: 'user',
                                content: prompt
                            }]
                        })
                    });
                    const data = await openrouterResponse.json();
                    generatedText = data.choices[0].message.content;
                    break;
            }

            if (loadingNotice) loadingNotice.hide();
            
            if (generatedText) {
                if (this.mode === 'replace') {
                    this.editor.replaceSelection(generatedText);
                } else {
                    const insertText = '\n\n' + generatedText + '\n\n';
                    this.editor.setCursor(cursor);
                    this.editor.replaceRange(insertText, cursor);
                }
                new obsidian.Notice('内容生成成功！', 3000);
            } else {
                throw new Error('生成的内容为空');
            }
        } catch (error) {
            if (loadingNotice) loadingNotice.hide();
            console.error('Content generation error:', error); // 添加错误日志
            new obsidian.Notice('请求失败：' + error.message, 5000);
        }
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

class OpenRouterSettingTab extends obsidian.PluginSettingTab {
    plugin;

    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const {containerEl} = this;
        containerEl.empty();

        // OpenRouter API Key 设置
        new obsidian.Setting(containerEl)
            .setName('OpenRouter API Key')
            .setDesc('输入你的 OpenRouter API Key')
            .addText(text => text
                .setPlaceholder('输入 API Key')
                .setValue(this.plugin.settings.openrouterApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openrouterApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Gemini API Key 设置
        new obsidian.Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('输入你的 Google Gemini API Key')
            .addText(text => text
                .setPlaceholder('输入 API Key')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Deepseek API Key 设置
        new obsidian.Setting(containerEl)
            .setName('Deepseek API Key')
            .setDesc('输入你的 Deepseek API Key')
            .addText(text => text
                .setPlaceholder('输入 API Key')
                .setValue(this.plugin.settings.deepseekApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.deepseekApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // 默认模型设置
        new obsidian.Setting(containerEl)
            .setName('默认模型')
            .setDesc('选择默认使用的 AI 模型')
            .addDropdown(dropdown => {
                [...BUILT_IN_MODELS, ...this.plugin.settings.customModels].forEach(model => {
                    dropdown.addOption(model.value, model.label);
                });
                
                dropdown.setValue(this.plugin.settings.defaultModel)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultModel = value;
                        await this.plugin.saveSettings();
                    });
            });

        // 自定义模型设置
        new obsidian.Setting(containerEl)
            .setName('自定义模型')
            .setDesc('添加自定义模型')
            .addButton(button => button
                .setButtonText('添加模型')
                .onClick(() => {
                    const modal = new CustomModelModal(this.app, async (modelInfo) => {
                        this.plugin.settings.customModels.push(modelInfo);
                        await this.plugin.saveSettings();
                        this.display(); // 刷新设置页面
                    });
                    modal.open();
                }));

        // 显示当前自定义模型列表
        if (this.plugin.settings.customModels.length > 0) {
            const customModelContainer = containerEl.createDiv('custom-model-list');
            this.plugin.settings.customModels.forEach((model, index) => {
                const modelDiv = customModelContainer.createDiv('custom-model-item');
                modelDiv.createEl('span', {text: `${model.label} (${model.value})`});
                const deleteButton = modelDiv.createEl('button', {text: '删除'});
                deleteButton.onclick = async () => {
                    this.plugin.settings.customModels.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display(); // 刷新设置页面
                };
            });
        }

        // 添加模板路设置
        new obsidian.Setting(containerEl)
            .setName('提示词模板路径')
            .setDesc('设置存放提示词模板的文件夹路径（例如：templates/prompts）')
            .addText(text => text
                .setPlaceholder('输入模板文件夹路径')
                .setValue(this.plugin.settings.templatePath)
                .onChange(async (value) => {
                    this.plugin.settings.templatePath = value;
                    await this.plugin.saveSettings();
                }));

        // 添加模板路径说明
        containerEl.createEl('div', {
            text: '提示：',
            cls: 'setting-item-description'
        });
        containerEl.createEl('ul', {cls: 'setting-item-description'}).innerHTML = `
            <li>在指定路径下创建 .md 文件作为提示词模板</li>
            <li>每个文件的文件名将作为模板名称</li>
            <li>文件内容将作为提示词模板</li>
            <li>使用插件时可以直接选择模板快速填入提示词</li>
        `;
    }
}

// 添加自定义模型的模态框
class CustomModelModal extends obsidian.Modal {
    constructor(app, onSubmit) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.createEl('h3', {text: '添加自定义模型'});

        const form = contentEl.createDiv();
        
        // 模型标识
        const valueInput = form.createEl('input', {
            type: 'text',
            placeholder: '模型标识 (例如: company/model-name)'
        });
        valueInput.style.marginBottom = '10px';

        // 显示名称
        const labelInput = form.createEl('input', {
            type: 'text',
            placeholder: '显示名称'
        });
        labelInput.style.marginBottom = '10px';

        // API提供商选择
        const providerSelect = form.createEl('select');
        ['openrouter', 'gemini', 'deepseek'].forEach(provider => {
            providerSelect.createEl('option', {
                value: provider,
                text: provider.charAt(0).toUpperCase() + provider.slice(1)
            });
        });
        providerSelect.style.marginBottom = '10px';

        // 提交按钮
        const submitButton = form.createEl('button', {
            text: '添加',
            cls: 'mod-cta'
        });
        submitButton.onclick = () => {
            if (valueInput.value && labelInput.value) {
                this.onSubmit({
                    value: valueInput.value,
                    label: labelInput.value,
                    provider: providerSelect.value
                });
                this.close();
            } else {
                new obsidian.Notice('请填写所有字段');
            }
        };
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

module.exports = OpenRouterPlugin; 