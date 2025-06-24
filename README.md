# 🎯 Calculadora Inteligente de Peso

Uma aplicação web avançada para cálculo e acompanhamento de peso com análise de TDEE real, adaptação metabólica e histórico personalizado.

![Preview](https://img.shields.io/badge/Status-Ativo-green.svg)
![Version](https://img.shields.io/badge/Version-2.0-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

## ✨ Funcionalidades

### 📊 Calculadora Avançada

- **Cálculo de TMB/BMR** usando fórmula Mifflin-St Jeor
- **TDEE personalizado** baseado no nível de atividade
- **Projeções inteligentes** de tempo para atingir meta
- **Análise de IMC** atual vs. objetivo
- **5 estratégias de déficit** (250-1000 kcal/dia)
- **Insights personalizados** baseados em seus dados

### 🧠 TDEE Real e Adaptação Metabólica

- **Cálculo do TDEE real** baseado em dados observados
- **Detecção de adaptação metabólica** (metabolismo mais lento/rápido)
- **Comparação teoria vs. realidade** com base em registros de calorias
- **Análise de confiança** dos dados (low/medium/high)
- **Alertas de adaptação** quando metabolismo se adapta >10%

### 📈 Sistema de Progresso

- **Registro diário** de peso, calorias e atividade
- **Gráfico visual** dos últimos 30 registros
- **Estatísticas automáticas**:
  - Dias consecutivos de registro
  - Progresso total em kg
  - Média semanal de mudança
  - Dias restantes para meta
  - TDEE real calculado
  - % de adaptação metabólica

### 📋 Histórico Completo

- **Visualização cronológica** de todos os registros
- **Exportação em CSV** para backup
- **Edição e exclusão** de registros individuais
- **Observações diárias** personalizadas

## 🚀 Como 

- Acesse https://selogerkkk.github.io/cal-track/

## 🏗️ Estrutura do Projeto

```
calculadora-peso/
├── index.html          # Página principal
├── styles.css          # Estilos da aplicação
├── app.js              # Lógica e funcionalidades
├── README.md           # Este arquivo
└── test.html           # Versão original (opcional)
```

## 💡 Como Funciona o TDEE Real

### Algoritmo Inteligente

A aplicação calcula seu gasto energético real usando a fórmula:

```
TDEE Real = Calorias Consumidas + (Mudança de Peso × 7700 kcal/kg ÷ dias)
```

### Exemplo Prático

- Você consome **2000 kcal/dia** por 14 dias
- Perde **0.5kg** no período
- Calorias do peso perdido: `0.5kg × 7700 = 3850 kcal`
- **TDEE Real** = `2000 + (3850 ÷ 14) = 2275 kcal/dia`

### Adaptação Metabólica

Compara seu TDEE real com o teórico:

- **-15%** = Metabolismo 15% mais lento (adaptação)
- **0%** = Metabolismo normal
- **+10%** = Metabolismo 10% mais rápido

## 🎯 Para Melhores Resultados

### Registro Consistente

- **Registre peso diariamente** no mesmo horário
- **Anote calorias** quando possível (mín. 7 dias)
- **Marque atividade** do dia para contexto

### Interpretação dos Dados

- **7-13 dias**: Confiança baixa, use como referência
- **14-20 dias**: Confiança média, boa estimativa
- **21+ dias**: Confiança alta, dados muito precisos

### Dicas Importantes

- Pesagem sempre nas mesmas condições
- Flutuações diárias são normais (0.5-1kg)
- Foque na tendência semanal, não dias isolados
- TDEE pode mudar com adaptações metabólicas

## 🔧 Recursos Técnicos

### Tecnologias

- **HTML5** + **CSS3** + **JavaScript ES6+**
- **SQLite.js** para banco de dados local
- **Canvas API** para gráficos personalizados
- **LocalStorage** como fallback

### Compatibilidade

- ✅ Chrome, Firefox, Safari, Edge (versões recentes)
- ✅ Dispositivos móveis e tablets
- ✅ Funciona offline após primeiro carregamento
- ✅ Dados salvos localmente no navegador

### Multi-usuário

- Sistema básico de usuários via localStorage
- Cada navegador = usuário independente
- Dados não são compartilhados entre dispositivos

## 📱 Interface Responsiva

- **Desktop**: Layout completo com 3 abas
- **Tablet**: Adaptação automática de layout
- **Mobile**: Interface otimizada para toque

## 🔒 Privacidade

- **100% local**: Dados nunca saem do seu navegador
- **Sem servidor**: Não há coleta de informações
- **Offline**: Funciona sem internet após carregamento
- **Seus dados**: Você tem controle total

## 🤝 Contribuições

Sinta-se à vontade para:

- Reportar bugs
- Sugerir melhorias
- Fazer fork do projeto
- Compartilhar com amigos

## 📄 Licença

MIT License - use livremente, modifique e distribua.

## 📞 Suporte

Para dúvidas ou sugestões:

- Abra uma issue no repositório
- Ou entre em contato diretamente

---

**Desenvolvido com ❤️ para ajudar pessoas a atingirem seus objetivos de peso de forma inteligente e baseada em ciência.**
